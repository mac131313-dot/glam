// PWA: service worker (push, tryb offline grafiku i karnetu – sekcja 10) i subskrypcja Web Push (sekcja 8).
import { api } from './api.ts';

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Prosi o zgodę i zapisuje subskrypcję push tego urządzenia. Zwraca, czy się udało. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const { publicKey } = await api<{ publicKey: string }>('/push/key', { global: true });
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/me/push-subscriptions', { method: 'POST', body: json, global: true });
  return true;
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Biometria (WebAuthn): zapis klucza na tym urządzeniu i logowanie bez SMS. */
const toB64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential;

export async function registerPasskey(label: string) {
  const o = await api<any>('/me/passkeys/options', { method: 'POST', global: true });
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: b64ToBytes(o.challenge),
      user: { ...o.user, id: b64ToBytes(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((c: { id: string }) => ({ type: 'public-key', id: b64ToBytes(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Nie udało się zapisać klucza.');
  const r = cred.response as AuthenticatorAttestationResponse;
  return api('/me/passkeys', { method: 'POST', global: true, body: { id: cred.id, label, response: { clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject) } } });
}

export async function loginWithPasskey(): Promise<{ token: string }> {
  const o = await api<any>('/auth/passkey/options', { method: 'POST', global: true });
  const cred = (await navigator.credentials.get({ publicKey: { ...o, challenge: b64ToBytes(o.challenge) } })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Logowanie przerwane.');
  const r = cred.response as AuthenticatorAssertionResponse;
  return api('/auth/passkey/verify', {
    method: 'POST',
    global: true,
    body: { id: cred.id, response: { clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature) } },
  });
}
