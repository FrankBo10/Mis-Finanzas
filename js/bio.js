// Desbloqueo con Face ID / Touch ID / huella.
//
// Cómo funciona, en simple:
// 1. El móvil crea una "llave de acceso" (passkey) protegida por Face ID.
// 2. Cada vez que pasas Face ID, esa llave nos devuelve un secreto (extensión "PRF"
//    del estándar WebAuthn). Sin tu cara (o el código del móvil) no hay secreto.
// 3. Con ese secreto ciframos tu contraseña y la guardamos cifrada en el móvil.
// 4. Para desbloquear: Face ID -> secreto -> desciframos la contraseña -> abrimos.
// La contraseña nunca se guarda en claro y nada de esto sale del dispositivo.
import { randomBytes } from './crypto.js';
import { loadVault, putRecord, deleteRecord } from './storage.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const bioSupported = () => !!(window.PublicKeyCredential && navigator.credentials);
export const bioRecord = () => loadVault('bio');
export const bioDisable = () => deleteRecord('bio');

async function keyFromSecret(bytes) {
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('mis-finanzas bio v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Pide Face ID y devuelve el secreto asociado a la llave.
async function getSecret(credId, salt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: credId }],
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const r = a.getClientExtensionResults().prf?.results?.first;
  if (!r) throw new Error('NO_PRF');
  return new Uint8Array(r);
}

// Paso 1: crea la llave de acceso. Lanza Error('NO_PRF') si el dispositivo no es compatible.
export async function bioCreate() {
  const salt = randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'Mis Finanzas', id: location.hostname },
      user: { id: randomBytes(16), name: 'mis-finanzas', displayName: 'Mis Finanzas' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none', timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const ext = cred.getClientExtensionResults().prf;
  if (!ext || (!ext.enabled && !ext.results?.first)) throw new Error('NO_PRF');
  return { credId: new Uint8Array(cred.rawId), salt, secret: ext.results?.first ? new Uint8Array(ext.results.first) : null };
}

// Paso 2: cifra la contraseña con el secreto de la llave y la guarda.
// Puede volver a pedir Face ID si el paso 1 no devolvió ya el secreto.
export async function bioFinish(part, password) {
  if (!part.secret) part.secret = await getSecret(part.credId, part.salt);
  const key = await keyFromSecret(part.secret);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(password)));
  await putRecord('bio', { credId: part.credId, salt: part.salt, iv, ct });
}

// Pide Face ID y devuelve la contraseña descifrada.
export async function bioUnlock() {
  const rec = await bioRecord();
  if (!rec) throw new Error('NO_RECORD');
  const key = await keyFromSecret(await getSecret(rec.credId, rec.salt));
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct));
}
