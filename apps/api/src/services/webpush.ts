// Web Push dla aplikacji PWA (8): szyfrowanie treści aes128gcm (RFC 8291 / 8188) i podpis VAPID (RFC 8292)
// na wbudowanym node:crypto – bez zewnętrznych bibliotek. Natywna aplikacja użyje APNs / FCM tym samym interfejsem.
import { createCipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes, sign, createPrivateKey, type ECDH, type JsonWebKey } from 'node:crypto';
import type { Db } from '../db.ts';
import type { PushSender } from '../sms.ts';

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

/** Klucze VAPID: z env albo wygenerowane raz i zapisane w ustawieniach platformy. */
export function vapidKeys(db: Db): VapidKeys {
  if (process.env.GLAM_VAPID_PRIVATE_JWK) {
    const jwk = JSON.parse(process.env.GLAM_VAPID_PRIVATE_JWK) as JsonWebKey;
    return { privateJwk: jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')])) };
  }
  const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as VapidKeys;
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const keys: VapidKeys = { privateJwk: jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')])) };
  db.prepare("INSERT INTO platform_settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

/** Zaszyfrowana treść zgodnie z RFC 8291 (jeden rekord, bez dopełnienia). */
export function encryptPayload(payload: string, p256dh: string, auth: string, salt = randomBytes(16), ephemeral?: ECDH) {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  if (!ephemeral) {
    ephemeral = createECDH('prime256v1');
    ephemeral.generateKeys();
  }
  const asPublic = ephemeral.getPublicKey();
  const ecdhSecret = ephemeral.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export function vapidJwt(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

export class WebPushSender implements PushSender {
  private readonly keys: VapidKeys;
  private readonly subject: string;
  constructor(db: Db, subject = process.env.GLAM_VAPID_SUBJECT ?? 'mailto:kontakt@glam.app') {
    this.keys = vapidKeys(db);
    this.subject = subject;
  }
  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url?: string }) {
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal',
          authorization: `vapid t=${vapidJwt(sub.endpoint, this.keys, this.subject)}, k=${this.keys.publicKey}`,
        },
        body: new Uint8Array(encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth)),
      });
      if (res.status === 404 || res.status === 410) return 'gone' as const;
      return res.ok ? ('ok' as const) : ('error' as const);
    } catch {
      return 'error' as const;
    }
  }
}
