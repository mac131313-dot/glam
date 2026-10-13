// Logowanie biometryczne (#2, 2.2): Face ID / Touch ID / odcisk palca przez WebAuthn (passkey na urządzeniu).
// Pierwsze logowanie kodem SMS, potem klucz platformowy. Weryfikacja na node:crypto + minimalny dekoder CBOR.
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { nowIso, type Db } from '../db.ts';
import { HttpError, badRequest } from '../errors.ts';

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

// ——— CBOR (RFC 8949) – tyle, ile potrzeba do attestationObject i klucza COSE ———

export function cborDecode(buf: Uint8Array): { value: unknown; length: number } {
  let pos = 0;
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return view[pos++];
    if (info === 25) {
      const v = view.readUInt16BE(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      const v = view.readUInt32BE(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      const v = Number(view.readBigUInt64BE(pos));
      pos += 8;
      return v;
    }
    throw new Error('CBOR: nieobsługiwana długość');
  };
  const item = (): unknown => {
    const byte = view[pos++];
    const major = byte >> 5;
    const info = byte & 0x1f;
    switch (major) {
      case 0:
        return readLen(info);
      case 1:
        return -1 - readLen(info);
      case 2: {
        const n = readLen(info);
        const out = view.subarray(pos, pos + n);
        pos += n;
        return new Uint8Array(out);
      }
      case 3: {
        const n = readLen(info);
        const out = view.toString('utf8', pos, pos + n);
        pos += n;
        return out;
      }
      case 4: {
        const n = readLen(info);
        return Array.from({ length: n }, () => item());
      }
      case 5: {
        const n = readLen(info);
        const m = new Map<unknown, unknown>();
        for (let i = 0; i < n; i++) {
          const k = item();
          m.set(k, item());
        }
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('CBOR: nieobsługiwana wartość prosta');
      default:
        throw new Error('CBOR: nieobsługiwany typ');
    }
  };
  const value = item();
  return { value, length: pos };
}

/** Klucz COSE → klucz publiczny SPKI (DER). Obsługujemy ES256 (-7) i RS256 (-257). */
export function coseToSpki(cose: Map<unknown, unknown>): { spki: Buffer; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3) as number;
  if (kty === 2) {
    const x = cose.get(-2) as Uint8Array;
    const y = cose.get(-3) as Uint8Array;
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) }, format: 'jwk' });
    return { spki: key.export({ type: 'spki', format: 'der' }) as Buffer, alg };
  }
  if (kty === 3) {
    const n = cose.get(-1) as Uint8Array;
    const e = cose.get(-2) as Uint8Array;
    const key = createPublicKey({ key: { kty: 'RSA', n: b64u(n), e: b64u(e) }, format: 'jwk' });
    return { spki: key.export({ type: 'spki', format: 'der' }) as Buffer, alg };
  }
  throw badRequest('Ten typ klucza nie jest obsługiwany.');
}

export function parseAuthData(data: Uint8Array) {
  const b = Buffer.from(data);
  const rpIdHash = b.subarray(0, 32);
  const flags = b[32];
  const signCount = b.readUInt32BE(33);
  let credentialId: Buffer | null = null;
  let publicKey: Map<unknown, unknown> | null = null;
  if (flags & 0x40) {
    const len = b.readUInt16BE(53);
    credentialId = b.subarray(55, 55 + len);
    publicKey = cborDecode(b.subarray(55 + len)).value as Map<unknown, unknown>;
  }
  return { rpIdHash, flags, signCount, credentialId, publicKey, userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04) };
}

export type RelyingParty = { id: string; origins: string[] };

function storeChallenge(db: Db, kind: string, userId: string | null) {
  const challenge = b64u(randomBytes(32));
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(challenge, userId, kind, Date.now() + 5 * 60_000);
  return challenge;
}

function takeChallenge(db: Db, challenge: string, kind: string) {
  const row = db.prepare('SELECT * FROM webauthn_challenges WHERE challenge = ? AND kind = ?').get(challenge, kind) as { user_id: string | null; expires_at: number } | undefined;
  db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').run(challenge);
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'challenge', 'Sesja potwierdzenia wygasła. Spróbuj jeszcze raz.');
  return row;
}

function checkClientData(raw: string, type: string, rp: RelyingParty) {
  const cd = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { type: string; challenge: string; origin: string };
  if (cd.type !== type) throw badRequest('Nieprawidłowe potwierdzenie.');
  if (!rp.origins.includes(cd.origin)) throw badRequest('Nieprawidłowe pochodzenie potwierdzenia.');
  return cd;
}

export function registrationOptions(db: Db, user: { id: string; phone: string; name: string | null }, rp: RelyingParty) {
  const existing = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?').all(user.id) as { id: string }[];
  return {
    challenge: storeChallenge(db, 'reg', user.id),
    rp: { name: 'GLAM', id: rp.id },
    user: { id: b64u(Buffer.from(user.id)), name: user.phone, displayName: user.name ?? user.phone },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.id })),
    attestation: 'none',
    timeout: 60_000,
  };
}

export function verifyRegistration(db: Db, userId: string, body: { id: string; response: { clientDataJSON: string; attestationObject: string } }, rp: RelyingParty, label?: string) {
  const cd = checkClientData(body.response.clientDataJSON, 'webauthn.create', rp);
  const ch = takeChallenge(db, cd.challenge, 'reg');
  if (ch.user_id !== userId) throw badRequest('Nieprawidłowe potwierdzenie.');
  const att = cborDecode(Buffer.from(body.response.attestationObject, 'base64url')).value as Map<string, unknown>;
  const auth = parseAuthData(att.get('authData') as Uint8Array);
  if (!auth.rpIdHash.equals(sha256(rp.id))) throw badRequest('Klucz należy do innej domeny.');
  if (!auth.userPresent || !auth.userVerified) throw badRequest('Potwierdź biometrią (Face ID / odcisk palca).');
  if (!auth.credentialId || !auth.publicKey) throw badRequest('Brak klucza w potwierdzeniu.');
  const { spki, alg } = coseToSpki(auth.publicKey);
  const credId = b64u(auth.credentialId);
  db.prepare('INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, algorithm, sign_count, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    credId,
    userId,
    spki,
    alg,
    auth.signCount,
    label ?? 'To urządzenie',
    nowIso(),
  );
  return { credentialId: credId };
}

export function loginOptions(db: Db, rp: RelyingParty) {
  return { challenge: storeChallenge(db, 'auth', null), rpId: rp.id, userVerification: 'required', allowCredentials: [], timeout: 60_000 };
}

/** Weryfikacja podpisu: authenticatorData || SHA-256(clientDataJSON). Zwraca id użytkowniczki. */
export function verifyLogin(db: Db, body: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string } }, rp: RelyingParty): string {
  const cd = checkClientData(body.response.clientDataJSON, 'webauthn.get', rp);
  takeChallenge(db, cd.challenge, 'auth');
  const cred = db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').get(body.id) as { user_id: string; public_key: Uint8Array; algorithm: number; sign_count: number } | undefined;
  if (!cred) throw new HttpError(401, 'unknown_key', 'Nie znamy tego urządzenia. Zaloguj się kodem SMS.');
  const authData = Buffer.from(body.response.authenticatorData, 'base64url');
  const auth = parseAuthData(authData);
  if (!auth.rpIdHash.equals(sha256(rp.id))) throw badRequest('Klucz należy do innej domeny.');
  if (!auth.userPresent || !auth.userVerified) throw badRequest('Potwierdź biometrią.');
  const signed = Buffer.concat([authData, sha256(Buffer.from(body.response.clientDataJSON, 'base64url'))]);
  const ok = verify('sha256', signed, { key: Buffer.from(cred.public_key), format: 'der', type: 'spki' }, Buffer.from(body.response.signature, 'base64url'));
  if (!ok) throw new HttpError(401, 'bad_signature', 'Nie udało się potwierdzić tożsamości.');
  // Licznik podpisów: jeśli nie rośnie, klucz mógł zostać sklonowany.
  if (cred.sign_count > 0 && auth.signCount <= cred.sign_count) throw new HttpError(401, 'cloned_key', 'Ten klucz wygląda na skopiowany. Zaloguj się kodem SMS.');
  db.prepare('UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?').run(auth.signCount, nowIso(), body.id);
  return cred.user_id;
}

