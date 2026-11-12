// Lógica de los datos: saldos, totales, recurrentes, CSV. No toca la pantalla.
import { uid, todayStr, addInterval, addMonthsYm, parseAmount, parseDateFlexible } from './util.js';

export const PALETTE = ['#007aff', '#ff9500', '#34c759', '#ff3b30', '#af52de', '#5ac8fa', '#ff2d55', '#5856d6', '#ffcc00', '#00c7be', '#a2845e', '#8e8e93'];

export const ACCOUNT_TYPES = [['cash', 'Efectivo'], ['bank', 'Banco'], ['card', 'Tarjeta'], ['savings', 'Ahorro'], ['invest', 'Inversión'], ['other', 'Otro']];
export const ACCOUNT_ICONS = { cash: '💶', bank: '🏦', card: '💳', savings: '🐖', invest: '📈', other: '👛' };

export function newState() {
  const exp = [['Comida', '🛒'], ['Restaurantes', '🍽️'], ['Transporte', '🚌'], ['Vivienda', '🏠'], ['Suministros', '💡'], ['Salud', '💊'], ['Ocio', '🎬'], ['Ropa', '👕'], ['Suscripciones', '📱'], ['Educación', '📚'], ['Regalos', '🎁'], ['Otros gastos', '📦']];
  const inc = [['Nómina', '💼'], ['Otros ingresos', '💶']];
  return {
    version: 1,
    settings: { currency: 'EUR', theme: 'auto', autoLockMin: 5, lastBackupAt: null, lastAccountId: null },
    accounts: [
      { id: uid(), name: 'Efectivo', type: 'cash', initial: 0, archived: false },
      { id: uid(), name: 'Banco', type: 'bank', initial: 0, archived: false },
    ],
    categories: [
      ...exp.map(([name, icon], i) => ({ id: uid(), name, icon, kind: 'expense', color: PALETTE[i % PALETTE.length], archived: false })),
      ...inc.map(([name, icon], i) => ({ id: uid(), name, icon, kind: 'income', color: PALETTE[(i * 2) % PALETTE.length], archived: false })),
    ],
    tx: [],
    budgets: [],
    recurring: [],
    goals: [],
    debts: [],
    trash: [], // movimientos borrados: [{ tx, deletedAt }]
  };
}

// Completa campos que falten (por ejemplo al restaurar una copia antigua).
export function migrate(S) {
  const base = newState();
  if (!S || typeof S !== 'object') return base;
  S.settings = { ...base.settings, ...(S.settings || {}) };
  for (const k of ['accounts', 'categories', 'tx', 'budgets', 'recurring', 'goals', 'debts', 'trash']) {
    if (!Array.isArray(S[k])) S[k] = [];
  }
  S.version = 1;
  return S;
}

// Un movimiento puede estar dividido en varias categorías ("splits").
// Esta función devuelve siempre la lista de partes: [{ categoryId, amount }].
export const txParts = (t) => (t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }]);

export const FEE_CATEGORY = { id: '__fee', name: 'Comisiones', icon: '🏦', color: '#8e8e93' };
const NO_CATEGORY = { id: '', name: 'Sin categoría', icon: '❔', color: '#c7c7cc' };

// Cuánto cambia el dinero de un conjunto de cuentas (ids) con un movimiento.
// En una transferencia, la comisión sale de la cuenta de origen además del importe.
function delta(t, ids) {
  if (t.type === 'expense') return ids.has(t.accountId) ? -t.amount : 0;
  if (t.type === 'income') return ids.has(t.accountId) ? t.amount : 0;
  return (ids.has(t.accountId) ? -(t.amount + (t.fee || 0)) : 0) + (ids.has(t.toAccountId) ? t.amount : 0);
}

export function balances(S) {
  const map = new Map(S.accounts.map((a) => [a.id, a.initial || 0]));
  const add = (id, v) => { if (map.has(id)) map.set(id, map.get(id) + v); };
  for (const t of S.tx) {
    if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'income') add(t.accountId, t.amount);
    else { add(t.accountId, -(t.amount + (t.fee || 0))); add(t.toAccountId, t.amount); }
  }
  return map;
}

// Saldo que quedaba después de cada movimiento. Devuelve un Map: id del movimiento -> saldo.
// Con accountId: saldo de esa cuenta. Sin él: suma de todas las cuentas no archivadas.
export function runningBalances(S, accountId) {
  const ids = new Set(accountId ? [accountId] : S.accounts.filter((a) => !a.archived).map((a) => a.id));
  let v = S.accounts.filter((a) => ids.has(a.id)).reduce((s, a) => s + (a.initial || 0), 0);
  const sorted = [...S.tx].sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0));
  const map = new Map();
  for (const t of sorted) { v += delta(t, ids); map.set(t.id, v); }
  return map;
}

export function monthTotals(S, ym) {
  let income = 0, expense = 0;
  for (const t of S.tx) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else expense += t.fee || 0; // la comisión de una transferencia es un gasto
  }
  return { income, expense, net: income - expense };
}

// Devuelve [{cat, total}] ordenado de mayor a menor para un mes y tipo.
export function byCategory(S, ym, kind) {
  const sums = new Map();
  const add = (k, v) => sums.set(k, (sums.get(k) || 0) + v);
  for (const t of S.tx) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === kind) for (const p of txParts(t)) add(p.categoryId || '', p.amount);
    else if (kind === 'expense' && t.type === 'transfer' && t.fee) add(FEE_CATEGORY.id, t.fee);
  }
  return [...sums.entries()]
    .map(([id, total]) => ({ cat: id === FEE_CATEGORY.id ? FEE_CATEGORY : S.categories.find((c) => c.id === id) || NO_CATEGORY, total }))
    .sort((a, b) => b.total - a.total);
}

export function spentInCategory(S, ym, categoryId) {
  let s = 0;
  for (const t of S.tx) {
    if (t.type !== 'expense' || !t.date.startsWith(ym)) continue;
    for (const p of txParts(t)) if (p.categoryId === categoryId) s += p.amount;
  }
  return s;
}

// ---------- Etiquetas ----------
export function allTags(S) {
  const set = new Map();
  for (const t of S.tx) for (const tag of t.tags || []) set.set(tag.toLowerCase(), tag);
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// Convierte "viaje, #coche" en ['viaje', 'coche'] (sin repetidos, máximo 10).
export function parseTags(text) {
  const out = [];
  for (const raw of String(text || '').split(/[,;\n]/)) {
    const tag = raw.trim().replace(/^#+/, '').trim().slice(0, 30);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 10);
}

// Gastos del mes por etiqueta: [{tag, total}]
export function byTag(S, ym) {
  const sums = new Map();
  for (const t of S.tx) {
    if (t.type !== 'expense' || !t.date.startsWith(ym)) continue;
    for (const tag of t.tags || []) sums.set(tag, (sums.get(tag) || 0) + t.amount);
  }
  return [...sums.entries()].map(([tag, total]) => ({ tag, total })).sort((a, b) => b.total - a.total);
}

// ---------- Papelera ----------
export const TRASH_DAYS = 30;
export function purgeTrash(S, now = Date.now()) {
  const before = S.trash.length;
  S.trash = S.trash.filter((x) => now - x.deletedAt < TRASH_DAYS * 864e5);
  return before - S.trash.length;
}

// Patrimonio (suma de cuentas no archivadas) al final de cada uno de los últimos n meses.
export function netWorthSeries(S, endYm, n) {
  const ids = new Set(S.accounts.filter((a) => !a.archived).map((a) => a.id));
  const base = S.accounts.filter((a) => ids.has(a.id)).reduce((s, a) => s + (a.initial || 0), 0);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = addMonthsYm(endYm, -i);
    const limit = ym + '-31';
    let v = base;
    for (const t of S.tx) if (t.date <= limit) v += delta(t, ids);
    out.push({ ym, value: v });
  }
  return out;
}

// Crea los movimientos recurrentes que tocaban hasta hoy. Devuelve cuántos creó.
export function runRecurring(S, today = todayStr()) {
  let n = 0;
  for (const r of S.recurring) {
    if (!r.active) continue;
    let guard = 0;
    while (r.nextDate <= today && (!r.endDate || r.nextDate <= r.endDate) && guard++ < 600) {
      S.tx.push({
        id: uid(), type: r.type, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId || null, fee: r.type === 'transfer' ? r.fee || null : null,
        categoryId: r.categoryId || null, date: r.nextDate, note: r.note || '', recurringId: r.id, ts: Date.now(),
      });
      r.nextDate = addInterval(r.nextDate, r.freq, r.interval || 1, r.anchorDay);
      n++;
    }
    if (r.endDate && r.nextDate > r.endDate) r.active = false;
  }
  return n;
}

// ---------- CSV ----------
export const CSV_HEADER = ['Fecha', 'Tipo', 'Importe', 'Cuenta', 'Cuenta destino', 'Categoría', 'Nota', 'Etiquetas', 'Comisión'];
const CSV_REQUIRED = 7; // las 7 primeras columnas son las obligatorias (formato de versiones anteriores)
const TYPE_ES = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' };

function csvCell(v) {
  let s = String(v ?? '');
  // Protección contra "inyección de fórmulas": si un texto empieza por = + - @,
  // Excel lo ejecutaría como fórmula. Le ponemos un apóstrofo delante.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(S) {
  const name = (list, id) => list.find((x) => x.id === id)?.name || '';
  const rows = [CSV_HEADER.join(';')];
  const sorted = [...S.tx].sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0));
  const num = (c) => (c / 100).toFixed(2).replace('.', ',');
  for (const t of sorted) {
    // Un movimiento dividido se exporta como una fila por cada parte.
    for (const p of txParts(t)) {
      rows.push([
        t.date, TYPE_ES[t.type], num(p.amount),
        csvCell(name(S.accounts, t.accountId)), csvCell(name(S.accounts, t.toAccountId)),
        csvCell(name(S.categories, p.categoryId)), csvCell(t.note),
        csvCell((t.tags || []).join(', ')), t.type === 'transfer' && t.fee ? num(t.fee) : '',
      ].join(';'));
    }
  }
  return '﻿' + rows.join('\r\n') + '\r\n'; // ﻿ hace que Excel lea bien los acentos
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const clean = (s) => String(s || '').replace(/^'(?=[=+\-@])/, '').slice(0, 120);
const txSig = (t) => [t.date, t.type, t.amount, t.accountId, t.toAccountId || '', (t.note || '').toLowerCase()].join('|');
// Firmas de todos los movimientos existentes (cada parte de uno dividido cuenta por separado).
const allSigs = (S) => new Set(S.tx.flatMap((t) => txParts(t).map((p) => txSig({ ...t, amount: p.amount }))));

function findOrCreateAccount(S, name) {
  let a = S.accounts.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!a) { a = { id: uid(), name, type: 'other', initial: 0, archived: false }; S.accounts.push(a); }
  return a;
}
function findOrCreateCategory(S, name, kind) {
  let c = S.categories.find((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
  if (!c) { c = { id: uid(), name, icon: '🏷️', kind, color: PALETTE[S.categories.length % PALETTE.length], archived: false }; S.categories.push(c); }
  return c;
}

export function isOwnCSV(header) {
  return CSV_HEADER.slice(0, CSV_REQUIRED).every((hd, i) => (header[i] || '').toLowerCase() === hd.toLowerCase());
}

// Importa un CSV exportado por esta misma app.
export function importOwnCSV(S, rows, skipDup = true) {
  const sigs = allSigs(S);
  const types = { gasto: 'expense', ingreso: 'income', transferencia: 'transfer' };
  const res = { added: 0, skipped: 0, errors: 0 };
  for (const r of rows.slice(1)) {
    const date = parseDateFlexible(r[0]);
    const type = types[(r[1] || '').toLowerCase()];
    const amount = parseAmount(r[2] || '');
    const accName = clean(r[3]);
    if (!date || !type || !amount || amount <= 0 || !accName || (type === 'transfer' && !clean(r[4]))) { res.errors++; continue; }
    const t = { id: uid(), type, amount, date, note: clean(r[6]), ts: Date.now(), accountId: findOrCreateAccount(S, accName).id, toAccountId: null, categoryId: null };
    if (type === 'transfer') {
      t.toAccountId = findOrCreateAccount(S, clean(r[4])).id;
      const fee = parseAmount(r[8] || '');
      if (fee > 0) t.fee = fee;
    }
    const tags = parseTags(clean(r[7]));
    if (tags.length) t.tags = tags;
    else if (clean(r[5])) t.categoryId = findOrCreateCategory(S, clean(r[5]), type).id;
    const sig = txSig(t);
    if (skipDup && sigs.has(sig)) { res.skipped++; continue; }
    sigs.add(sig); S.tx.push(t); res.added++;
  }
  return res;
}

// Importa un CSV de un banco u otra app. Importe negativo = gasto, positivo = ingreso.
export function importGenericCSV(S, rows, { dateCol, amountCol, descCol, catCol, accountId, skipDup = true }) {
  const sigs = allSigs(S);
  const res = { added: 0, skipped: 0, errors: 0 };
  for (const r of rows.slice(1)) {
    const date = parseDateFlexible(r[dateCol]);
    const cents = parseAmount(r[amountCol] || '');
    if (!date || !cents) { res.errors++; continue; }
    const type = cents < 0 ? 'expense' : 'income';
    const t = { id: uid(), type, amount: Math.abs(cents), date, note: descCol >= 0 ? clean(r[descCol]) : '', ts: Date.now(), accountId, toAccountId: null, categoryId: null };
    if (catCol >= 0 && clean(r[catCol])) t.categoryId = findOrCreateCategory(S, clean(r[catCol]), type).id;
    const sig = txSig(t);
    if (skipDup && sigs.has(sig)) { res.skipped++; continue; }
    sigs.add(sig); S.tx.push(t); res.added++;
  }
  return res;
}
