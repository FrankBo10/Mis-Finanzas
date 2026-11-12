// Arranque de la app: pantalla de bloqueo, guardado cifrado, copias de seguridad.
import { $, h, todayStr } from './util.js';
import { KDF_ITER, deriveKey, encryptJSON, decryptJSON, randomBytes, toB64, fromB64 } from './crypto.js';
import { loadVault, saveVault, clearVault } from './storage.js';
import { newState, migrate, runRecurring } from './model.js';
import { initViews, render, go, resetNav, editTx } from './views.js';
import { toast, closeAllSheets, confirmDialog } from './forms.js';
import { bioSupported, bioRecord, bioDisable, bioCreate, bioFinish, bioUnlock } from './bio.js';

const MIN_PW = 8;

const app = {
  state: null,   // los datos, solo en memoria mientras la app está desbloqueada
  key: null,     // la clave de cifrado, solo en memoria
  salt: null,
  suspendLock: false,
  bioSupported: bioSupported(),
  bioEnabled: false, // ¿está activado Face ID?
  enableBio, disableBio,
  save, saveNow, lock, exportBackup, restoreBackup, changePassword, wipe, pickFile, saveFile, applyTheme,
  runRecurring: () => runRecurring(app.state),
};
initViews(app);

// ---------- Guardado ----------
let saveTimer = null;
let saving = Promise.resolve();

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!app.key || !app.state) return saving;
  const key = app.key, salt = app.salt, state = app.state;
  saving = saving.then(async () => {
    const { iv, ct } = await encryptJSON(key, state);
    await saveVault({ salt, iter: KDF_ITER, iv, ct, savedAt: Date.now() });
  }).catch((e) => toast('⚠️ Error al guardar: ' + (e && e.message ? e.message : e)));
  return saving;
}

// ---------- Bloqueo ----------
let mode = 'unlock';       // 'unlock' = ya hay datos; 'setup' = primera vez
let restoreFile = null;    // copia elegida en la pantalla de bienvenida

function showLock(newMode) {
  mode = newMode;
  restoreFile = null;
  const setup = mode === 'setup';
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-title').textContent = setup ? 'Bienvenido a Mis Finanzas' : 'Mis Finanzas';
  $('#lock-msg').textContent = setup
    ? 'Crea una contraseña para cifrar tus datos. Mínimo 8 caracteres; mejor una frase larga que solo tú conozcas.'
    : 'Escribe tu contraseña para abrir la app.';
  $('#pw').value = ''; $('#pw2').value = '';
  $('#pw').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  $('#pw2-row').hidden = !setup;
  $('#setup-extra').hidden = !setup;
  $('#restore-info').textContent = '';
  $('#lock-btn').textContent = setup ? 'Crear y empezar' : 'Desbloquear';
  $('#lock-error').hidden = true;
  $('#bio-btn').hidden = setup || !app.bioEnabled || !app.bioSupported;
}

async function lock() {
  await saveNow();
  app.key = null; app.state = null; app.salt = null;
  closeAllSheets();
  $('#toast').hidden = true;
  $('#main').replaceChildren();
  delete document.documentElement.dataset.theme;
  showLock('unlock');
}

function enter() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  $('#pw').value = ''; $('#pw2').value = '';
  applyTheme();
  resetNav();
  const n = runRecurring(app.state);
  if (n) { save(); toast(`🔁 Se han apuntado ${n} movimientos recurrentes`); }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function applyTheme() {
  const t = app.state?.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function readBackup(file, password) {
  if (file.size > 50e6) throw new Error('El archivo es demasiado grande.');
  let b;
  try { b = JSON.parse(await file.text()); } catch { throw new Error('El archivo no es una copia de seguridad válida.'); }
  const iter = Number(b?.kdf?.iter);
  if (b?.app !== 'mis-finanzas' || !b.kdf?.salt || !b.iv || !b.data || !(iter >= 100000 && iter <= 5000000)) {
    throw new Error('El archivo no es una copia de seguridad de esta app.');
  }
  try {
    const key = await deriveKey(password, fromB64(b.kdf.salt), iter);
    return migrate(await decryptJSON(key, fromB64(b.iv), fromB64(b.data)));
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  }
}

// Intenta abrir los datos con una contraseña. Devuelve true si lo consigue.
async function unlockWith(pw) {
  let opened = null;
  for (const name of ['main', 'prev']) { // 'prev' = guardado anterior, por si el último estuviera dañado
    const rec = await loadVault(name);
    if (!rec) continue;
    try {
      const key = await deriveKey(pw, rec.salt, rec.iter || KDF_ITER);
      opened = { state: await decryptJSON(key, rec.iv, rec.ct), key, rec };
      break;
    } catch { /* contraseña incorrecta o registro dañado: probamos el siguiente */ }
  }
  if (!opened) return false;
  app.state = migrate(opened.state);
  if ((opened.rec.iter || KDF_ITER) === KDF_ITER) { app.key = opened.key; app.salt = opened.rec.salt; }
  else { app.salt = randomBytes(16); app.key = await deriveKey(pw, app.salt); save(); }
  enter();
  return true;
}

// ---------- Face ID ----------
async function onBioClick() {
  const err = $('#lock-error'), btn = $('#bio-btn');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true; btn.disabled = true;
  try {
    let pw;
    try { pw = await bioUnlock(); }
    catch (e) { return fail(e && e.name === 'NotAllowedError' ? 'Face ID cancelado. Puedes usar tu contraseña.' : 'No se ha podido usar Face ID. Usa tu contraseña.'); }
    if (!(await unlockWith(pw))) {
      await bioDisable(); app.bioEnabled = false; btn.hidden = true;
      fail('Face ID ya no es válido para estos datos. Entra con tu contraseña y vuelve a activarlo en Ajustes.');
    }
  } finally { btn.disabled = false; }
}

async function checkPassword(pw) {
  await saveNow();
  const rec = await loadVault('main');
  try {
    const k = await deriveKey(pw, rec.salt, rec.iter || KDF_ITER);
    await decryptJSON(k, rec.iv, rec.ct);
    return true;
  } catch { return false; }
}

// Activa Face ID. Devuelve true o un mensaje de error para mostrar.
async function enableBio(pw) {
  if (!app.bioSupported) return 'Este dispositivo o navegador no permite usar Face ID aquí.';
  if (!(await checkPassword(pw))) return 'La contraseña no es correcta.';
  // Cada petición de Face ID debe ir justo después de un toque del usuario; por eso los diálogos.
  if (!(await confirmDialog('Ahora tu dispositivo te pedirá Face ID (o huella) y guardará una llave de acceso para esta app.', { ok: 'Continuar' }))) return 'Cancelado.';
  app.suspendLock = true;
  try {
    let part;
    try { part = await bioCreate(); }
    catch (e) {
      return e.message === 'NO_PRF' ? 'Tu dispositivo no es compatible con esta función (en iPhone hace falta iOS 18 o posterior).'
        : 'No se ha podido crear la llave de acceso (cancelado o no disponible).';
    }
    try { await bioFinish(part, pw); }
    catch (e) {
      if (e.message === 'NO_PRF') return 'Tu dispositivo no es compatible con esta función (en iPhone hace falta iOS 18 o posterior).';
      if (!(await confirmDialog('Confirma una vez más con Face ID para terminar.', { ok: 'Confirmar' }))) return 'Cancelado.';
      try { await bioFinish(part, pw); } catch { return 'No se ha podido terminar de activar Face ID.'; }
    }
    app.bioEnabled = true;
    return true;
  } finally { app.suspendLock = false; }
}

async function disableBio() {
  await bioDisable();
  app.bioEnabled = false;
}

async function onLockSubmit(ev) {
  ev.preventDefault();
  const btn = $('#lock-btn'), err = $('#lock-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  const pw = $('#pw').value;
  err.hidden = true;
  if (!pw) return fail('Escribe la contraseña.');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un momento…';
  try {
    if (mode === 'setup') {
      let state;
      if (restoreFile) {
        state = await readBackup(restoreFile, pw);
      } else {
        if (pw.length < MIN_PW) return fail(`La contraseña debe tener al menos ${MIN_PW} caracteres.`);
        if (pw !== $('#pw2').value) return fail('Las dos contraseñas no coinciden.');
        state = newState();
      }
      app.salt = randomBytes(16);
      app.key = await deriveKey(pw, app.salt);
      app.state = state;
      await saveNow();
      enter();
    } else if (!(await unlockWith(pw))) {
      return fail('Contraseña incorrecta.');
    }
  } catch (e) {
    fail(e.message || 'Ha ocurrido un error.');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// ---------- Copias de seguridad ----------
async function exportBackup() {
  await saveNow();
  const { iv, ct } = await encryptJSON(app.key, app.state);
  const text = JSON.stringify({
    app: 'mis-finanzas', format: 1, created: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: KDF_ITER, salt: toB64(app.salt) },
    cipher: 'AES-256-GCM', iv: toB64(iv), data: toB64(ct),
  });
  // Comprobamos que la copia se puede volver a abrir antes de dártela.
  try {
    const b = JSON.parse(text);
    await decryptJSON(app.key, fromB64(b.iv), fromB64(b.data));
  } catch { return toast('⚠️ La copia no ha superado la comprobación. Inténtalo de nuevo.'); }
  const ok = await saveFile(`mis-finanzas-copia-${todayStr()}.json`, text, 'application/json');
  if (ok && app.state) {
    app.state.settings.lastBackupAt = Date.now();
    save(); render();
    toast('Copia creada y comprobada. Guárdala fuera del móvil.');
  }
}

async function restoreBackup(file, password) {
  let state;
  try { state = await readBackup(file, password); } catch (e) { return e.message; }
  app.state = state;
  runRecurring(app.state);
  applyTheme();
  await saveNow();
  return true;
}

async function changePassword(oldPw, newPw) {
  if (!(await checkPassword(oldPw))) return 'La contraseña actual no es correcta.';
  app.salt = randomBytes(16);
  app.key = await deriveKey(newPw, app.salt);
  await saveNow();
  await saveNow(); // segundo guardado: así la versión anterior ("prev") también queda con la clave nueva
  if (app.bioEnabled) await disableBio(); // Face ID guardaba la contraseña antigua: hay que reactivarlo
  return true;
}

async function wipe() {
  clearTimeout(saveTimer);
  app.key = null; app.state = null;
  await saving;
  await clearVault();
  location.reload();
}

// ---------- Archivos ----------
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'visually-hidden' });
    app.suspendLock = true;
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// Entrega un archivo al usuario: en iPhone abre el menú "Compartir"
// (desde ahí: "Guardar en Archivos"); en ordenador lo descarga.
async function saveFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  app.suspendLock = true;
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; /* si falla, descargamos */ }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } finally {
    setTimeout(() => { app.suspendLock = false; }, 1000);
  }
}

// ---------- Eventos ----------
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (saveTimer) saveNow(); // guarda al instante al salir de la app
    if (app.key && !app.suspendLock && app.state.settings.autoLockMin === 0) lock();
  } else {
    if (app.suspendLock) { app.suspendLock = false; return; }
    if (app.key && hiddenAt && Date.now() - hiddenAt >= app.state.settings.autoLockMin * 60000) lock();
  }
});

$('#lock-form').addEventListener('submit', onLockSubmit);
$('#bio-btn').addEventListener('click', onBioClick);
$('#restore-btn').addEventListener('click', async () => {
  const f = await pickFile('.json,application/json');
  app.suspendLock = false;
  if (!f) return;
  restoreFile = f;
  $('#pw2-row').hidden = true;
  $('#lock-msg').textContent = 'Escribe la contraseña que tenía la app cuando se creó esa copia. Será también tu contraseña en este móvil.';
  $('#restore-info').textContent = `Copia elegida: ${f.name}`;
  $('#lock-btn').textContent = 'Restaurar copia';
});
for (const b of document.querySelectorAll('#tabbar [data-tab]')) b.addEventListener('click', () => go(b.dataset.tab));
$('#add-btn').addEventListener('click', () => editTx());

async function boot() {
  if (!window.isSecureContext || !crypto.subtle || !window.indexedDB) {
    $('#lock-title').textContent = 'No se puede abrir';
    $('#lock-msg').textContent = 'Esta app necesita abrirse desde una dirección segura (https://) en un navegador actualizado.';
    $('#lock-form').hidden = true;
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  let vault = null;
  try { vault = (await loadVault('main')) || (await loadVault('prev')); }
  catch { $('#lock-msg').textContent = 'No se puede acceder al almacenamiento del navegador. ¿Estás en navegación privada?'; $('#lock-form').hidden = true; return; }
  try { app.bioEnabled = !!(vault && (await bioRecord())); } catch { app.bioEnabled = false; }
  showLock(vault ? 'unlock' : 'setup');
}
boot();
