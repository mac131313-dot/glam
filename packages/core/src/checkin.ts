// Kod wejścia na żywo: QR zmienia się co 30 s, więc zrzut ekranu wysłany znajomej przestaje działać po chwili.
// Telefon dostaje z serwera dzienny sekret i sam liczy kolejne kody (działa też offline); recepcja liczy to samo.
// SHA-256 w czystym TS zamiast crypto.subtle – subtle działa tylko na HTTPS, a demo na telefonie idzie po http w Wi-Fi.

/** Co tyle zmienia się kod QR. */
export const CHECKIN_STEP_MS = 30_000;

/** Dzienny sekret do kodu wejścia (z /api/my/checkin-code i z listy najbliższych zajęć). */
export type LiveCheckin = { user: string; date: string; seed: string };

export const checkinStep = (at = Date.now()) => Math.floor(at / CHECKIN_STEP_MS);

/** Kod do QR na dane okno 30 s. Serwer sprawdza go tą samą funkcją. */
export function liveCheckinCode({ user, date, seed }: LiveCheckin, step: number): string {
  const sig = hmacSha256Hex(seed, `${user}.${date}.${step}`).slice(0, 16);
  return `GLAM2.${user}.${date}.${step}.${sig}`;
}

/**
 * Czy kod z danego okna jeszcze przechodzi. Za ścisło – kod zmieni się w ręce, zanim recepcja zeskanuje,
 * albo zegar telefonu spieszy się o kilka sekund; za luźno – zrzut ekranu zdąży dojść do znajomej.
 */
export function acceptCheckinStep(codeStep: number, nowStep: number): boolean {
  // Bieżące okno ± jedno: kod ważny 30–90 s.
  return Math.abs(codeStep - nowStep) <= 1;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(buf.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

export function hmacSha256Hex(key: string, message: string): string {
  const enc = new TextEncoder();
  let k: Uint8Array = enc.encode(key);
  if (k.length > 64) k = sha256(k);
  const block = new Uint8Array(64);
  block.set(k);
  const inner = new Uint8Array(64 + enc.encode(message).length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.set(enc.encode(message), 64);
  outer.set(sha256(inner), 64);
  return Array.from(sha256(outer), (b) => b.toString(16).padStart(2, '0')).join('');
}
