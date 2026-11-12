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

// ---------- Fortaleza de la contraseña ----------
// Valoración orientativa (no es infalible). score: 0 = muy débil (no se acepta),
// 1 = débil, 2 = aceptable, 3 = fuerte.
const COMMON = ['12345678', '123456789', '1234567890', '87654321', 'password', 'password1', 'contraseña', 'contrasena',
  'qwertyui', 'qwertyuiop', 'qwerty123', 'asdfghjk', 'abcd1234', 'abc12345', 'iloveyou', 'tequiero', '11111111', '00000000',
  'misfinanzas', 'mis finanzas', 'finanzas'];

export function passwordStrength(pw) {
  const res = (score, label, tip) => ({ score, label, tip });
  if (!pw) return res(0, '', '');
  const low = pw.toLowerCase();
  if (pw.length < 8) return res(0, 'Muy corta', 'Necesita al menos 8 caracteres.');
  if (COMMON.includes(low) || COMMON.some((c) => low === c + c)) return res(0, 'Muy débil', 'Es una de las contraseñas más usadas: se adivina al instante.');
  if (new Set(pw).size < 4) return res(0, 'Muy débil', 'Repite casi siempre los mismos caracteres.');
  const codes = Array.from(pw, (ch) => ch.charCodeAt(0));
  const steps = codes.slice(1).map((c, i) => c - codes[i]);
  if (steps.every((d) => d === 1) || steps.every((d) => d === -1)) return res(0, 'Muy débil', 'Es una secuencia seguida (como 12345678 o abcdefgh).');
  if (/^\d+$/.test(pw) && pw.length < 12) return res(0, 'Muy débil', 'Solo números y pocos: se puede adivinar probando. Añade letras o hazla más larga.');
  const classes = [/[a-zñáéíóúü]/, /[A-ZÑÁÉÍÓÚÜ]/, /\d/, /[^A-Za-z0-9ñÑáéíóúüÁÉÍÓÚÜ]/].filter((re) => re.test(pw)).length;
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 2)) return res(3, 'Fuerte', 'Buena contraseña.');
  if (pw.length >= 12 || (pw.length >= 10 && classes >= 2) || classes >= 3) return res(2, 'Aceptable', 'Para que sea fuerte, hazla más larga: una frase de varias palabras funciona muy bien.');
  return res(1, 'Débil', 'Hazla más larga o mezcla letras, números y símbolos. Una frase de varias palabras es lo mejor.');
}
