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
  };
}

// Completa campos que falten (por ejemplo al restaurar una copia antigua).
export function migrate(S) {
  const base = newState();
  if (!S || typeof S !== 'object') return base;
  S.settings = { ...base.settings, ...(S.settings || {}) };
  for (const k of ['accounts', 'categories', 'tx', 'budgets', 'recurring', 'goals', 'debts']) {
    if (!Array.isArray(S[k])) S[k] = [];
  }
  S.version = 1;
  return S;
}

export function balances(S) {
  const map = new Map(S.accounts.map((a) => [a.id, a.initial || 0]));
  const add = (id, v) => { if (map.has(id)) map.set(id, map.get(id) + v); };
  for (const t of S.tx) {
    if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'income') add(t.accountId, t.amount);
    else { add(t.accountId, -t.amount); add(t.toAccountId, t.amount); }
  }
  return map;
}

export function monthTotals(S, ym) {
  let income = 0, expense = 0;
  for (const t of S.tx) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

// Devuelve [{cat, total}] ordenado de mayor a menor para un mes y tipo.
export function byCategory(S, ym, kind) {
  const sums = new Map();
  for (const t of S.tx) {
    if (t.type !== kind || !t.date.startsWith(ym)) continue;
    const k = t.categoryId || '';
    sums.set(k, (sums.get(k) || 0) + t.amount);
  }
  const none = { id: '', name: 'Sin categoría', icon: '❔', color: '#c7c7cc' };
  return [...sums.entries()]
    .map(([id, total]) => ({ cat: S.categories.find((c) => c.id === id) || none, total }))
    .sort((a, b) => b.total - a.total);
}

export function spentInCategory(S, ym, categoryId) {
  let s = 0;
  for (const t of S.tx) if (t.type === 'expense' && t.categoryId === categoryId && t.date.startsWith(ym)) s += t.amount;
  return s;
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
    for (const t of S.tx) {
      if (t.date > limit) continue;
      if (t.type === 'expense') { if (ids.has(t.accountId)) v -= t.amount; }
      else if (t.type === 'income') { if (ids.has(t.accountId)) v += t.amount; }
      else { if (ids.has(t.accountId)) v -= t.amount; if (ids.has(t.toAccountId)) v += t.amount; }
    }
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
        id: uid(), type: r.type, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId || null,
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
export const CSV_HEADER = ['Fecha', 'Tipo', 'Importe', 'Cuenta', 'Cuenta destino', 'Categoría', 'Nota'];
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
  for (const t of sorted) {
    rows.push([
      t.date, TYPE_ES[t.type], (t.amount / 100).toFixed(2).replace('.', ','),
      csvCell(name(S.accounts, t.accountId)), csvCell(name(S.accounts, t.toAccountId)),
      csvCell(name(S.categories, t.categoryId)), csvCell(t.note),
    ].join(';'));
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
  return CSV_HEADER.every((hd, i) => (header[i] || '').toLowerCase() === hd.toLowerCase());
}

// Importa un CSV exportado por esta misma app.
export function importOwnCSV(S, rows, skipDup = true) {
  const sigs = new Set(S.tx.map(txSig));
  const types = { gasto: 'expense', ingreso: 'income', transferencia: 'transfer' };
  const res = { added: 0, skipped: 0, errors: 0 };
  for (const r of rows.slice(1)) {
    const date = parseDateFlexible(r[0]);
    const type = types[(r[1] || '').toLowerCase()];
    const amount = parseAmount(r[2] || '');
    const accName = clean(r[3]);
    if (!date || !type || !amount || amount <= 0 || !accName || (type === 'transfer' && !clean(r[4]))) { res.errors++; continue; }
    const t = { id: uid(), type, amount, date, note: clean(r[6]), ts: Date.now(), accountId: findOrCreateAccount(S, accName).id, toAccountId: null, categoryId: null };
    if (type === 'transfer') t.toAccountId = findOrCreateAccount(S, clean(r[4])).id;
    else if (clean(r[5])) t.categoryId = findOrCreateCategory(S, clean(r[5]), type).id;
    const sig = txSig(t);
    if (skipDup && sigs.has(sig)) { res.skipped++; continue; }
    sigs.add(sig); S.tx.push(t); res.added++;
  }
  return res;
}

// Importa un CSV de un banco u otra app. Importe negativo = gasto, positivo = ingreso.
export function importGenericCSV(S, rows, { dateCol, amountCol, descCol, catCol, accountId, skipDup = true }) {
  const sigs = new Set(S.tx.map(txSig));
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
