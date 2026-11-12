// Utilidades generales: crear elementos HTML de forma segura, fechas y dinero.

export const $ = (sel, root = document) => root.querySelector(sel);

// Crea un elemento HTML. El texto SIEMPRE se inserta como texto (nunca como HTML),
// así un dato malicioso (p. ej. de un CSV importado) no puede ejecutar código.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  fill(el, attrs, kids);
  return el;
}

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  fill(el, attrs, kids);
  return el;
}

function fill(el, attrs, kids) {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Fechas (siempre como texto 'AAAA-MM-DD') ----------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addMonthsYm(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthLabel(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const txt = new Intl.DateTimeFormat('es-ES', short ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(d);
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
export function dayLabel(s) {
  const txt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseYmd(s));
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
export function shortDate(s) {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseYmd(s));
}

// Avanza una fecha según la frecuencia de un movimiento recurrente.
export function addInterval(dateStr, freq, interval = 1, anchorDay) {
  const d = parseYmd(dateStr);
  if (freq === 'weekly') {
    d.setDate(d.getDate() + 7 * interval);
    return ymd(d);
  }
  const months = freq === 'yearly' ? 12 * interval : interval;
  const day = anchorDay || d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(day, lastDay)); // p. ej. día 31 en febrero -> 28/29
  return ymd(first);
}

// Acepta fechas AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA y DD/MM/AA.
export function parseDateFlexible(str) {
  if (!str) return null;
  const s = String(str).trim().slice(0, 10).trim();
  let y, m, d;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (r) [, y, m, d] = r.map(Number);
  else {
    r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!r) return null;
    [, d, m, y] = r.map(Number);
    if (y < 100) y += 2000;
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return ymd(dt);
}

// ---------- Dinero ----------
// Todo el dinero se guarda en CÉNTIMOS como número entero (1250 = 12,50 €).
// Así se evitan los errores de redondeo de los decimales (0.1 + 0.2 != 0.3).
export function parseAmount(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim().replace(/[\s€$£]/g, '').replace(/[−–]/g, '-');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    // El separador que aparece el último es el decimal: 1.234,56 o 1,234.56
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc > -1) {
    s = s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ld > -1) {
    const p = s.split('.');
    // "1.234" en España significa mil doscientos treinta y cuatro
    if (p.length > 2 || (p[1].length === 3 && p[0].length >= 1 && p[0].length <= 3 && p[0] !== '0')) s = p.join('');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

export const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');

const fmtCache = new Map();
export function money(cents, currency = 'EUR') {
  let f = fmtCache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { style: 'currency', currency, useGrouping: 'always' });
    fmtCache.set(currency, f);
  }
  return f.format(cents / 100);
}
