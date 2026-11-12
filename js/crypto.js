// Cifrado de los datos con la Web Crypto API (viene incluida en el navegador,
// no usamos ninguna librería externa).
//
// - De tu contraseña se obtiene una clave con PBKDF2 (SHA-256, 600.000 vueltas).
//   Las "vueltas" hacen que probar contraseñas al azar sea muy lento.
// - Los datos se cifran con AES-GCM de 256 bits. Además de ocultar los datos,
//   AES-GCM detecta si alguien los ha modificado.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITER = 600000;

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, salt, iterations = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // la clave no se puede extraer de la memoria del navegador
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12); // un valor aleatorio nuevo en cada guardado
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv, ct: new Uint8Array(ct) };
}

// Lanza un error si la contraseña es incorrecta o los datos están dañados.
export async function decryptJSON(key, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
