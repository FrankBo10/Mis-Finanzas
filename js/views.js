// Todas las pantallas de la app.
import { h, $, uid, todayStr, addMonthsYm, monthLabel, dayLabel, shortDate, money, centsToInput } from './util.js';
import {
  balances, monthTotals, byCategory, spentInCategory, netWorthSeries, toCSV, parseCSV, isOwnCSV, importOwnCSV,
  importGenericCSV, PALETTE, ACCOUNT_TYPES, ACCOUNT_ICONS,
} from './model.js';
import { donut, bars, line } from './charts.js';
import { openForm, openSheet, toast, confirmDialog } from './forms.js';

let app;
const nav = { tab: 'home', sub: null, month: todayStr().slice(0, 7), search: '', filterAcc: '', repKind: 'expense' };

export function initViews(a) { app = a; }
export function resetNav() { Object.assign(nav, { tab: 'home', sub: null, month: todayStr().slice(0, 7), search: '', filterAcc: '' }); }
export function go(tab, sub = null) { nav.tab = tab; nav.sub = sub; render(); window.scrollTo(0, 0); }

export function render() {
  if (!app.state) return;
  const view = nav.tab === 'more' && nav.sub ? SUBS[nav.sub]() : TABS[nav.tab]();
  $('#main').replaceChildren(view);
  for (const b of document.querySelectorAll('#tabbar [data-tab]')) b.classList.toggle('on', b.dataset.tab === nav.tab);
}

const fmt = (c) => money(c, app.state.settings.currency);
const changed = () => { app.save(); render(); };
const accName = (id) => app.state.accounts.find((a) => a.id === id)?.name || '(cuenta eliminada)';
const card = (title, ...kids) => h('section', { class: 'card' }, title && h('h3', null, title), kids);
const empty = (txt) => h('p', { class: 'empty' }, txt);
const page = (title, ...kids) => h('div', { class: 'page' }, h('h1', null, title), kids);
const subPage = (title, ...kids) => h('div', { class: 'page' },
  h('button', { type: 'button', class: 'link back', onclick: () => go('more') }, '‹ Más'), h('h1', null, title), kids);
const addBtn = (label, fn) => h('button', { type: 'button', class: 'btn primary block', onclick: fn }, label);

function monthNav() {
  const move = (n) => () => { nav.month = addMonthsYm(nav.month, n); render(); };
  return h('div', { class: 'month-nav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: move(-1) }, '‹'),
    h('strong', null, monthLabel(nav.month)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: move(1) }, '›'));
}

function txRow(t) {
  const cat = app.state.categories.find((c) => c.id === t.categoryId);
  const isTr = t.type === 'transfer';
  const title = isTr ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : cat?.name || 'Sin categoría';
  const sub = [!isTr && accName(t.accountId), t.note, t.recurringId && '🔁'].filter(Boolean).join(' · ');
  const sign = t.type === 'expense' ? '−' : t.type === 'income' ? '+' : '';
  return h('button', { type: 'button', class: 'row', onclick: () => editTx(t) },
    h('span', { class: 'ico' }, isTr ? '↔️' : cat?.icon || '❔'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub && h('span', { class: 'row-sub' }, sub)),
    h('span', { class: 'amt ' + t.type }, sign + fmt(t.amount)));
}

function progress(pct) {
  const fill = h('div', { class: 'bar-fill' + (pct > 1 ? ' over' : pct > 0.85 ? ' warn' : '') });
  fill.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
  return h('div', { class: 'bar' }, fill);
}

function budgetRow(b, ym) {
  const c = app.state.categories.find((x) => x.id === b.categoryId);
  if (!c) return null;
  const spent = spentInCategory(app.state, ym, c.id);
  return h('button', { type: 'button', class: 'stack-row', onclick: () => editBudget(b) },
    h('div', { class: 'split' }, h('span', null, `${c.icon} ${c.name}`), h('span', null, `${fmt(spent)} / ${fmt(b.amount)}`)),
    progress(b.amount ? spent / b.amount : 0),
    h('div', { class: 'row-sub' }, spent > b.amount ? `Te has pasado ${fmt(spent - b.amount)}` : `Te quedan ${fmt(b.amount - spent)}`));
}

// ================= INICIO =================
function homeView() {
  const S = app.state, bal = balances(S), today = todayStr(), ym = today.slice(0, 7);
  const active = S.accounts.filter((a) => !a.archived);
  const total = active.reduce((s, a) => s + bal.get(a.id), 0);
  const mt = monthTotals(S, ym);
  const last = S.settings.lastBackupAt;
  const needBackup = S.tx.length >= 5 && (!last || Date.now() - last > 30 * 864e5);
  const recent = [...S.tx].sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0)).slice(0, 6);
  const upcoming = S.recurring.filter((r) => r.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 3);

  return h('div', { class: 'page' },
    h('section', { class: 'hero' },
      h('span', { class: 'hero-label' }, 'Patrimonio total'),
      h('strong', { class: 'hero-total' + (total < 0 ? ' neg' : '') }, fmt(total)),
      h('div', { class: 'hero-month' },
        h('div', null, h('span', null, `Ingresos de ${monthLabel(ym, true).toLowerCase()}`), h('b', { class: 'income' }, '+' + fmt(mt.income))),
        h('div', null, h('span', null, 'Gastos'), h('b', { class: 'expense' }, '−' + fmt(mt.expense))),
        h('div', null, h('span', null, 'Balance'), h('b', null, fmt(mt.net))))),
    app.updateReady && h('button', { type: 'button', class: 'banner update', onclick: () => app.applyUpdate() }, 'Hay una versión nueva descargada. Toca aquí para actualizar.'),
    needBackup && h('button', { type: 'button', class: 'banner', onclick: () => go('more', 'data') },
      last ? '⚠️ Hace más de 30 días de tu última copia de seguridad. Toca aquí para hacer una.' : '⚠️ Aún no has hecho ninguna copia de seguridad. Si pierdes el móvil, pierdes los datos. Toca aquí.'),
    card('Cuentas', active.length ? active.map((a) => h('button', { type: 'button', class: 'row', onclick: () => { nav.filterAcc = a.id; nav.search = ''; go('tx'); } },
      h('span', { class: 'ico' }, ACCOUNT_ICONS[a.type] || '👛'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, a.name)),
      h('span', { class: 'amt' + (bal.get(a.id) < 0 ? ' expense' : '') }, fmt(bal.get(a.id))))) : empty('No tienes cuentas. Créalas en Más → Cuentas.')),
    S.budgets.length ? card('Presupuestos de este mes', S.budgets.map((b) => budgetRow(b, ym))) : null,
    upcoming.length ? card('Próximos recurrentes', upcoming.map((r) => h('div', { class: 'row static' },
      h('span', { class: 'ico' }, '🔁'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.note || recurringTitle(r)), h('span', { class: 'row-sub' }, shortDate(r.nextDate))),
      h('span', { class: 'amt ' + r.type }, fmt(r.amount))))) : null,
    card('Últimos movimientos', recent.length ? recent.map(txRow) : empty('Todavía no hay movimientos. Pulsa el botón + para añadir el primero.')),
    h('p', { class: 'version' }, 'Mis Finanzas · versión ' + app.version));
}

// ================= MOVIMIENTOS =================
function txView() {
  const S = app.state;
  const list = h('div');
  const fill = () => {
    const q = nav.search.trim().toLowerCase();
    let items = S.tx.filter((t) => (q || t.date.startsWith(nav.month)) && (!nav.filterAcc || t.accountId === nav.filterAcc || t.toAccountId === nav.filterAcc));
    if (q) {
      items = items.filter((t) => {
        const cat = S.categories.find((c) => c.id === t.categoryId)?.name || '';
        return [t.note || '', cat, accName(t.accountId), centsToInput(t.amount)].some((x) => x.toLowerCase().includes(q));
      });
    }
    items.sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
    const shown = items.slice(0, 400);
    const out = [];
    if (!shown.length) out.push(empty(q ? 'Ningún movimiento coincide con la búsqueda.' : 'No hay movimientos en este mes.'));
    let day = null, box = null;
    for (const t of shown) {
      if (t.date !== day) {
        day = t.date;
        const net = items.filter((x) => x.date === day).reduce((s, x) => s + (x.type === 'income' ? x.amount : x.type === 'expense' ? -x.amount : 0), 0);
        box = h('section', { class: 'card' }, h('div', { class: 'split day-head' }, h('span', null, dayLabel(day)), h('span', null, fmt(net))));
        out.push(box);
      }
      box.append(txRow(t));
    }
    if (items.length > shown.length) out.push(empty(`Se muestran los primeros ${shown.length} de ${items.length}. Afina la búsqueda para ver el resto.`));
    list.replaceChildren(...out);
  };
  const search = h('input', { type: 'search', placeholder: 'Buscar en todos los meses…', 'aria-label': 'Buscar movimientos', autocomplete: 'off', oninput: () => { nav.search = search.value; fill(); } });
  search.value = nav.search;
  const accSel = h('select', { 'aria-label': 'Filtrar por cuenta', onchange: () => { nav.filterAcc = accSel.value; fill(); } },
    h('option', { value: '' }, 'Todas las cuentas'), S.accounts.map((a) => h('option', { value: a.id }, a.name)));
  accSel.value = nav.filterAcc;
  fill();
  return page('Movimientos', monthNav(), h('div', { class: 'filters' }, search, accSel), list);
}

export function editTx(t) {
  const S = app.state, isNew = !t;
  const accs = S.accounts.filter((a) => !a.archived || (t && (a.id === t.accountId || a.id === t.toAccountId))).map((a) => [a.id, a.name]);
  if (!accs.length) return toast('Primero crea una cuenta en Más → Cuentas');
  const values = t ? { ...t, categoryId: t.categoryId ?? '' } : { type: 'expense', date: todayStr(), accountId: S.settings.lastAccountId, note: '' };
  if (isNew) values.toAccountId = accs.find(([id]) => id !== (values.accountId || accs[0][0]))?.[0];
  openForm({
    title: isNew ? 'Nuevo movimiento' : 'Editar movimiento',
    values,
    fields: [
      { key: 'type', label: 'Tipo', type: 'seg', options: [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']] },
      { key: 'amount', label: 'Importe', type: 'money', required: true, positive: true, autofocus: isNew },
      { key: 'categoryId', label: 'Categoría', type: 'select', showIf: (v) => v.type !== 'transfer',
        options: (v) => [...S.categories.filter((c) => c.kind === v.type && (!c.archived || c.id === values.categoryId)).map((c) => [c.id, `${c.icon} ${c.name}`]), ['', 'Sin categoría']] },
      { key: 'accountId', label: 'Cuenta', type: 'select', options: accs },
      { key: 'toAccountId', label: 'Cuenta destino', type: 'select', showIf: (v) => v.type === 'transfer', options: accs },
      { key: 'date', label: 'Fecha', type: 'date', required: true },
      { key: 'note', label: 'Nota (opcional)', type: 'text' },
    ],
    validate: (o) => (o.type === 'transfer' && o.accountId === o.toAccountId ? 'La cuenta de origen y la de destino deben ser distintas.' : null),
    onSave: (o) => {
      if (isNew) S.tx.push({ id: uid(), ts: Date.now(), ...o }); else Object.assign(t, o);
      S.settings.lastAccountId = o.accountId;
      changed();
      toast(isNew ? 'Movimiento guardado' : 'Cambios guardados');
    },
    onDelete: isNew ? null : (close) => {
      S.tx.splice(S.tx.indexOf(t), 1);
      close(); changed();
      toast('Movimiento eliminado', { action: 'Deshacer', onAction: () => { app.state.tx.push(t); changed(); } });
    },
    extraButtons: isNew ? [] : [{ label: 'Duplicar con fecha de hoy', onClick: (close) => { close(); S.tx.push({ ...t, id: uid(), ts: Date.now(), date: todayStr(), recurringId: null }); changed(); toast('Movimiento duplicado'); } }],
  });
}

// ================= INFORMES =================
function reportsView() {
  const S = app.state, ym = nav.month, kind = nav.repKind;
  const mt = monthTotals(S, ym), prev = monthTotals(S, addMonthsYm(ym, -1));
  const cats = byCategory(S, ym, kind);
  const total = cats.reduce((s, c) => s + c.total, 0);
  const diff = (now, before) => (before ? `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))} % respecto al mes anterior` : 'Sin datos del mes anterior');
  const seg = h('div', { class: 'seg' }, [['expense', 'Gastos'], ['income', 'Ingresos']].map(([v, l]) =>
    h('button', { type: 'button', class: v === kind ? 'on' : '', onclick: () => { nav.repKind = v; render(); } }, l)));
  const months = Array.from({ length: 6 }, (_, i) => addMonthsYm(ym, i - 5)).map((m) => ({ ym: m, ...monthTotals(S, m) }));

  return page('Informes', monthNav(),
    h('div', { class: 'grid2' },
      h('section', { class: 'card stat' }, h('span', null, 'Ingresos'), h('b', { class: 'income' }, fmt(mt.income)), h('small', null, diff(mt.income, prev.income))),
      h('section', { class: 'card stat' }, h('span', null, 'Gastos'), h('b', { class: 'expense' }, fmt(mt.expense)), h('small', null, diff(mt.expense, prev.expense)))),
    card('Ahorro del mes', h('p', { class: 'big' + (mt.net < 0 ? ' expense' : ' income') }, fmt(mt.net)),
      mt.income > 0 && h('p', { class: 'row-sub' }, `Has ahorrado el ${Math.round((mt.net / mt.income) * 100)} % de tus ingresos.`)),
    card('Por categorías', seg,
      total ? [donut(cats.map((c) => ({ color: c.cat.color, value: c.total })), kind === 'expense' ? 'Gastos' : 'Ingresos', fmt(total)),
        cats.map((c) => {
          const dot = h('span', { class: 'dot' }); dot.style.background = c.cat.color;
          return h('div', { class: 'row static' }, dot,
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `${c.cat.icon} ${c.cat.name}`)),
            h('span', { class: 'amt' }, fmt(c.total), h('small', null, ` ${Math.round((c.total / total) * 100)} %`)));
        })] : empty('No hay datos en este mes.')),
    card('Últimos 6 meses', bars(months), h('p', { class: 'legend' }, h('span', { class: 'lg income' }, 'Ingresos'), h('span', { class: 'lg expense' }, 'Gastos'))),
    card('Evolución del patrimonio (12 meses)', line(netWorthSeries(S, ym, 12))));
}

// ================= MÁS =================
function moreView() {
  const item = (icon, label, sub, fn) => h('button', { type: 'button', class: 'row', onclick: fn },
    h('span', { class: 'ico' }, icon), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label), sub && h('span', { class: 'row-sub' }, sub)), h('span', { class: 'chev' }, '›'));
  const S = app.state;
  return page('Más',
    card(null,
      item('🏦', 'Cuentas', `${S.accounts.filter((a) => !a.archived).length} activas`, () => go('more', 'accounts')),
      item('🏷️', 'Categorías', null, () => go('more', 'categories')),
      item('🎯', 'Presupuestos', 'Límite de gasto mensual por categoría', () => go('more', 'budgets')),
      item('🔁', 'Recurrentes', 'Alquiler, nómina, suscripciones…', () => go('more', 'recurring')),
      item('🐖', 'Metas de ahorro', null, () => go('more', 'goals')),
      item('🤝', 'Deudas y préstamos', null, () => go('more', 'debts'))),
    card(null,
      item('💾', 'Copias de seguridad y datos', 'Exportar, importar, restaurar', () => go('more', 'data')),
      item('⚙️', 'Ajustes y seguridad', 'Moneda, tema, bloqueo, contraseña', () => go('more', 'settings')),
      item('🔒', 'Bloquear ahora', null, () => app.lock()),
      item('ℹ️', 'Privacidad y acerca de', null, () => go('more', 'about'))));
}

// ---------- Cuentas ----------
function accountsView() {
  const S = app.state, bal = balances(S);
  const row = (a) => h('button', { type: 'button', class: 'row', onclick: () => editAccount(a) },
    h('span', { class: 'ico' }, ACCOUNT_ICONS[a.type] || '👛'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, a.name), h('span', { class: 'row-sub' }, (ACCOUNT_TYPES.find(([k]) => k === a.type) || [])[1] + (a.archived ? ' · archivada' : ''))),
    h('span', { class: 'amt' }, fmt(bal.get(a.id))));
  return subPage('Cuentas', card(null, S.accounts.length ? S.accounts.map(row) : empty('No hay cuentas.')), addBtn('+ Nueva cuenta', () => editAccount()));
}

function editAccount(a) {
  const S = app.state, isNew = !a;
  const used = a && (S.tx.some((t) => t.accountId === a.id || t.toAccountId === a.id) || S.recurring.some((r) => r.accountId === a.id || r.toAccountId === a.id));
  openForm({
    title: isNew ? 'Nueva cuenta' : 'Editar cuenta',
    values: a ? { ...a, archived: a.archived ? 'yes' : 'no' } : { type: 'bank', initial: 0, archived: 'no' },
    fields: [
      { key: 'name', label: 'Nombre', required: true, maxlength: 40, autofocus: isNew },
      { key: 'type', label: 'Tipo', type: 'select', options: ACCOUNT_TYPES },
      { key: 'initial', label: 'Saldo inicial', type: 'money', allowNegative: true, hint: 'El dinero que tiene la cuenta antes de empezar a apuntar. Puede ser negativo.' },
      !isNew && { key: 'archived', label: 'Estado', type: 'select', options: [['no', 'Activa'], ['yes', 'Archivada (oculta, conserva su historial)']] },
    ].filter(Boolean),
    onSave: (o) => {
      const data = { name: o.name, type: o.type, initial: o.initial || 0, archived: o.archived === 'yes' };
      if (isNew) S.accounts.push({ id: uid(), ...data }); else Object.assign(a, data);
      changed();
    },
    onDelete: isNew ? null : async (close) => {
      if (used) return toast('Esta cuenta tiene movimientos. No se puede borrar, pero puedes archivarla.');
      if (!(await confirmDialog(`¿Eliminar la cuenta "${a.name}"?`, { ok: 'Eliminar', danger: true }))) return;
      S.accounts.splice(S.accounts.indexOf(a), 1); close(); changed();
    },
  });
}

// ---------- Categorías ----------
function categoriesView() {
  const S = app.state;
  const row = (c) => {
    const dot = h('span', { class: 'dot' }); dot.style.background = c.color;
    return h('button', { type: 'button', class: 'row', onclick: () => editCategory(c) }, h('span', { class: 'ico' }, c.icon),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), c.archived && h('span', { class: 'row-sub' }, 'archivada')), dot);
  };
  const group = (kind, title) => card(title, S.categories.filter((c) => c.kind === kind).map(row));
  return subPage('Categorías', group('expense', 'Gastos'), group('income', 'Ingresos'), addBtn('+ Nueva categoría', () => editCategory()));
}

function editCategory(c) {
  const S = app.state, isNew = !c;
  openForm({
    title: isNew ? 'Nueva categoría' : 'Editar categoría',
    values: c ? { ...c, archived: c.archived ? 'yes' : 'no' } : { kind: 'expense', icon: '🏷️', color: PALETTE[S.categories.length % PALETTE.length], archived: 'no' },
    fields: [
      { key: 'name', label: 'Nombre', required: true, maxlength: 40, autofocus: isNew },
      isNew && { key: 'kind', label: 'Tipo', type: 'seg', options: [['expense', 'Gasto'], ['income', 'Ingreso']] },
      { key: 'icon', label: 'Icono (un emoji)', maxlength: 8, required: true },
      { key: 'color', label: 'Color', type: 'color' },
      !isNew && { key: 'archived', label: 'Estado', type: 'select', options: [['no', 'Activa'], ['yes', 'Archivada (no aparece al añadir)']] },
    ].filter(Boolean),
    onSave: (o) => {
      const data = { name: o.name, icon: o.icon, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : PALETTE[0], archived: o.archived === 'yes' };
      if (isNew) S.categories.push({ id: uid(), kind: o.kind, ...data }); else Object.assign(c, data);
      changed();
    },
    onDelete: isNew ? null : async (close) => {
      const n = S.tx.filter((t) => t.categoryId === c.id).length;
      const msg = n ? `¿Eliminar "${c.name}"? Sus ${n} movimientos NO se borran: quedarán como "Sin categoría".` : `¿Eliminar la categoría "${c.name}"?`;
      if (!(await confirmDialog(msg, { ok: 'Eliminar', danger: true }))) return;
      for (const t of S.tx) if (t.categoryId === c.id) t.categoryId = null;
      for (const r of S.recurring) if (r.categoryId === c.id) r.categoryId = null;
      S.budgets = S.budgets.filter((b) => b.categoryId !== c.id);
      S.categories.splice(S.categories.indexOf(c), 1); close(); changed();
    },
  });
}

// ---------- Presupuestos ----------
function budgetsView() {
  const S = app.state, ym = todayStr().slice(0, 7);
  const totalB = S.budgets.reduce((s, b) => s + b.amount, 0);
  return subPage('Presupuestos',
    h('p', { class: 'help' }, 'Pon un límite de gasto mensual a una categoría. La barra se pone naranja al 85 % y roja si te pasas.'),
    card(S.budgets.length ? `Total presupuestado: ${fmt(totalB)} al mes` : null, S.budgets.length ? S.budgets.map((b) => budgetRow(b, ym)) : empty('No hay presupuestos todavía.')),
    addBtn('+ Nuevo presupuesto', () => editBudget()));
}

function editBudget(b) {
  const S = app.state, isNew = !b;
  const free = S.categories.filter((c) => c.kind === 'expense' && (c.id === b?.categoryId || (!c.archived && !S.budgets.some((x) => x.categoryId === c.id))));
  if (!free.length) return toast('Todas las categorías de gasto ya tienen presupuesto');
  openForm({
    title: isNew ? 'Nuevo presupuesto' : 'Editar presupuesto',
    values: b ? { ...b } : {},
    fields: [
      { key: 'categoryId', label: 'Categoría', type: 'select', options: free.map((c) => [c.id, `${c.icon} ${c.name}`]) },
      { key: 'amount', label: 'Límite mensual', type: 'money', required: true, positive: true, autofocus: isNew },
    ],
    onSave: (o) => { if (isNew) S.budgets.push({ id: uid(), ...o }); else Object.assign(b, o); changed(); },
    onDelete: isNew ? null : (close) => { S.budgets.splice(S.budgets.indexOf(b), 1); close(); changed(); },
  });
}

// ---------- Recurrentes ----------
const FREQ = [['monthly', 'Cada mes'], ['weekly', 'Cada semana'], ['yearly', 'Cada año']];
function recurringTitle(r) {
  if (r.type === 'transfer') return `${accName(r.accountId)} → ${accName(r.toAccountId)}`;
  return app.state.categories.find((c) => c.id === r.categoryId)?.name || (r.type === 'expense' ? 'Gasto' : 'Ingreso');
}
function freqText(r) {
  const n = r.interval || 1;
  const unit = { monthly: ['mes', 'meses'], weekly: ['semana', 'semanas'], yearly: ['año', 'años'] }[r.freq];
  return n === 1 ? `Cada ${unit[0]}` : `Cada ${n} ${unit[1]}`;
}
function monthlyEquivalent(r) {
  const n = r.interval || 1;
  return Math.round(r.amount * (r.freq === 'weekly' ? 52 / 12 / n : r.freq === 'yearly' ? 1 / 12 / n : 1 / n));
}

function recurringView() {
  const S = app.state;
  const act = S.recurring.filter((r) => r.active);
  const sum = (type) => act.filter((r) => r.type === type).reduce((s, r) => s + monthlyEquivalent(r), 0);
  const row = (r) => h('button', { type: 'button', class: 'row', onclick: () => editRecurring(r) },
    h('span', { class: 'ico' }, r.active ? '🔁' : '⏸️'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.note || recurringTitle(r)),
      h('span', { class: 'row-sub' }, r.active ? `${freqText(r)} · próximo: ${shortDate(r.nextDate)}` : 'En pausa o finalizado')),
    h('span', { class: 'amt ' + r.type }, fmt(r.amount)));
  return subPage('Recurrentes',
    h('p', { class: 'help' }, 'Movimientos que se repiten. La app los apunta sola cuando llega su fecha (al abrirla).'),
    act.length ? card('Estimación de gastos fijos', h('div', { class: 'split' }, h('span', null, 'Al mes'), h('b', { class: 'expense' }, fmt(sum('expense')))),
      h('div', { class: 'split' }, h('span', null, 'Al año'), h('b', { class: 'expense' }, fmt(sum('expense') * 12))),
      sum('income') ? h('div', { class: 'split' }, h('span', null, 'Ingresos fijos al mes'), h('b', { class: 'income' }, fmt(sum('income')))) : null) : null,
    card(null, S.recurring.length ? S.recurring.map(row) : empty('No hay movimientos recurrentes.')),
    addBtn('+ Nuevo recurrente', () => editRecurring()));
}

function editRecurring(r) {
  const S = app.state, isNew = !r;
  const accs = S.accounts.filter((a) => !a.archived || a.id === r?.accountId || a.id === r?.toAccountId).map((a) => [a.id, a.name]);
  if (!accs.length) return toast('Primero crea una cuenta');
  openForm({
    title: isNew ? 'Nuevo recurrente' : 'Editar recurrente',
    values: r ? { ...r, categoryId: r.categoryId ?? '', active: r.active ? 'yes' : 'no' } : { type: 'expense', freq: 'monthly', interval: 1, nextDate: todayStr(), active: 'yes', toAccountId: accs[1]?.[0] },
    fields: [
      { key: 'type', label: 'Tipo', type: 'seg', options: [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']] },
      { key: 'note', label: 'Nombre', required: true, placeholder: 'Ej.: Alquiler', maxlength: 60, autofocus: isNew },
      { key: 'amount', label: 'Importe', type: 'money', required: true, positive: true },
      { key: 'categoryId', label: 'Categoría', type: 'select', showIf: (v) => v.type !== 'transfer',
        options: (v) => [...S.categories.filter((c) => c.kind === v.type && !c.archived).map((c) => [c.id, `${c.icon} ${c.name}`]), ['', 'Sin categoría']] },
      { key: 'accountId', label: 'Cuenta', type: 'select', options: accs },
      { key: 'toAccountId', label: 'Cuenta destino', type: 'select', showIf: (v) => v.type === 'transfer', options: accs },
      { key: 'freq', label: 'Frecuencia', type: 'select', options: FREQ },
      { key: 'interval', label: 'Repetir cada (1 = cada mes/semana/año, 2 = cada dos…)', type: 'number', required: true },
      { key: 'nextDate', label: 'Próxima fecha', type: 'date', required: true, hint: 'Si pones una fecha pasada, se apuntarán todos los que falten hasta hoy.' },
      { key: 'endDate', label: 'Fecha de fin (opcional)', type: 'date' },
      { key: 'active', label: 'Estado', type: 'select', options: [['yes', 'Activo'], ['no', 'En pausa']] },
    ],
    validate: (o) => (o.type === 'transfer' && o.accountId === o.toAccountId ? 'La cuenta de origen y la de destino deben ser distintas.'
      : o.endDate && o.endDate < o.nextDate ? 'La fecha de fin no puede ser anterior a la próxima fecha.' : null),
    onSave: (o) => {
      const data = { ...o, active: o.active === 'yes', anchorDay: Number(o.nextDate.slice(8)) };
      if (isNew) S.recurring.push({ id: uid(), ...data }); else Object.assign(r, data);
      const n = app.runRecurring();
      changed();
      if (n) toast(`Se han apuntado ${n} movimientos pendientes`);
    },
    onDelete: isNew ? null : async (close) => {
      if (!(await confirmDialog('¿Eliminar este recurrente? Los movimientos que ya creó no se borran.', { ok: 'Eliminar', danger: true }))) return;
      S.recurring.splice(S.recurring.indexOf(r), 1); close(); changed();
    },
  });
}

// ---------- Metas ----------
function goalsView() {
  const S = app.state;
  const row = (g) => h('div', { class: 'stack-row static' },
    h('div', { class: 'split' }, h('b', null, g.name), h('span', null, `${fmt(g.saved)} / ${fmt(g.target)}`)),
    progressGoal(g.target ? g.saved / g.target : 0),
    h('div', { class: 'row-sub' }, g.saved >= g.target ? '🎉 ¡Meta conseguida!' : `Faltan ${fmt(g.target - g.saved)}` + (g.deadline ? ` · fecha límite: ${shortDate(g.deadline)}` : '')),
    h('div', { class: 'mini-btns' },
      h('button', { type: 'button', class: 'btn small', onclick: () => contribute(g, 'saved', 'Aportar a la meta', 'Cantidad a añadir (negativa para retirar)') }, 'Aportar'),
      h('button', { type: 'button', class: 'btn small', onclick: () => editGoal(g) }, 'Editar')));
  return subPage('Metas de ahorro',
    h('p', { class: 'help' }, 'Apunta para qué ahorras y cuánto llevas. Es un contador aparte: no mueve dinero de tus cuentas.'),
    card(null, S.goals.length ? S.goals.map(row) : empty('No hay metas todavía.')), addBtn('+ Nueva meta', () => editGoal()));
}
function progressGoal(pct) {
  const el = progress(Math.min(pct, 1));
  el.firstChild.classList.remove('over', 'warn');
  el.firstChild.classList.add('good');
  return el;
}
function editGoal(g) {
  const S = app.state, isNew = !g;
  openForm({
    title: isNew ? 'Nueva meta' : 'Editar meta', values: g ? { ...g } : { saved: 0 },
    fields: [
      { key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Vacaciones', maxlength: 60, autofocus: isNew },
      { key: 'target', label: 'Objetivo', type: 'money', required: true, positive: true },
      { key: 'saved', label: 'Ahorrado hasta ahora', type: 'money' },
      { key: 'deadline', label: 'Fecha límite (opcional)', type: 'date' },
    ],
    onSave: (o) => { o.saved = o.saved || 0; if (isNew) S.goals.push({ id: uid(), ...o }); else Object.assign(g, o); changed(); },
    onDelete: isNew ? null : async (close) => {
      if (!(await confirmDialog(`¿Eliminar la meta "${g.name}"?`, { ok: 'Eliminar', danger: true }))) return;
      S.goals.splice(S.goals.indexOf(g), 1); close(); changed();
    },
  });
}
function contribute(obj, key, title, label) {
  openForm({
    title, fields: [{ key: 'v', label, type: 'money', required: true, allowNegative: true, autofocus: true }],
    onSave: (o) => { obj[key] = Math.max(0, (obj[key] || 0) + o.v); changed(); },
  });
}

// ---------- Deudas ----------
function debtsView() {
  const S = app.state;
  const pending = (dir) => S.debts.filter((d) => d.direction === dir).reduce((s, d) => s + Math.max(0, d.amount - d.paid), 0);
  const row = (d) => h('div', { class: 'stack-row static' },
    h('div', { class: 'split' }, h('b', null, d.name), h('span', { class: d.direction === 'owe' ? 'expense' : 'income' }, fmt(Math.max(0, d.amount - d.paid)))),
    progressGoal(d.amount ? d.paid / d.amount : 0),
    h('div', { class: 'row-sub' }, (d.direction === 'owe' ? 'Debo yo' : 'Me deben') + ` · pagado ${fmt(d.paid)} de ${fmt(d.amount)}` + (d.note ? ` · ${d.note}` : '')),
    h('div', { class: 'mini-btns' },
      h('button', { type: 'button', class: 'btn small', onclick: () => contribute(d, 'paid', 'Registrar pago', 'Cantidad pagada') }, 'Registrar pago'),
      h('button', { type: 'button', class: 'btn small', onclick: () => editDebt(d) }, 'Editar')));
  return subPage('Deudas y préstamos',
    h('p', { class: 'help' }, 'Lleva la cuenta de lo que debes y de lo que te deben. Es un contador aparte: no mueve dinero de tus cuentas.'),
    S.debts.length ? h('div', { class: 'grid2' },
      h('section', { class: 'card stat' }, h('span', null, 'Debo'), h('b', { class: 'expense' }, fmt(pending('owe')))),
      h('section', { class: 'card stat' }, h('span', null, 'Me deben'), h('b', { class: 'income' }, fmt(pending('owed'))))) : null,
    card(null, S.debts.length ? S.debts.map(row) : empty('No hay deudas apuntadas.')), addBtn('+ Nueva deuda', () => editDebt()));
}
function editDebt(d) {
  const S = app.state, isNew = !d;
  openForm({
    title: isNew ? 'Nueva deuda' : 'Editar deuda', values: d ? { ...d } : { direction: 'owe', paid: 0 },
    fields: [
      { key: 'direction', label: '¿Quién debe?', type: 'seg', options: [['owe', 'Debo yo'], ['owed', 'Me deben']] },
      { key: 'name', label: 'Persona o entidad', required: true, maxlength: 60, autofocus: isNew },
      { key: 'amount', label: 'Importe total', type: 'money', required: true, positive: true },
      { key: 'paid', label: 'Ya pagado', type: 'money' },
      { key: 'note', label: 'Nota (opcional)' },
    ],
    onSave: (o) => { o.paid = o.paid || 0; if (isNew) S.debts.push({ id: uid(), ...o }); else Object.assign(d, o); changed(); },
    onDelete: isNew ? null : async (close) => {
      if (!(await confirmDialog(`¿Eliminar la deuda de "${d.name}"?`, { ok: 'Eliminar', danger: true }))) return;
      S.debts.splice(S.debts.indexOf(d), 1); close(); changed();
    },
  });
}

// ---------- Copias de seguridad y datos ----------
function dataView() {
  const S = app.state, last = S.settings.lastBackupAt;
  const action = (label, sub, fn, cls = '') => h('button', { type: 'button', class: 'row ' + cls, onclick: fn },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label), h('span', { class: 'row-sub' }, sub)), h('span', { class: 'chev' }, '›'));
  return subPage('Copias de seguridad y datos',
    h('p', { class: 'help' }, 'Tus datos solo están en este móvil. Si lo pierdes, se rompe o borras los datos de Safari, solo podrás recuperarlos con una copia de seguridad. Haz una de vez en cuando y guárdala fuera del móvil (por ejemplo en tu ordenador).'),
    card('Copia de seguridad cifrada',
      h('p', { class: 'row-sub pad' }, last ? `Última copia: ${new Date(last).toLocaleString('es-ES')}` : 'Aún no has hecho ninguna copia.'),
      action('Crear copia de seguridad', 'Un archivo cifrado con tu contraseña actual. Incluye todo.', () => app.exportBackup()),
      action('Restaurar una copia', 'Sustituye los datos actuales por los de un archivo de copia.', restoreFlow)),
    card('Hoja de cálculo (CSV)',
      action('Exportar movimientos a CSV', 'Para abrir en Excel o Numbers. ⚠️ Este archivo NO va cifrado.', async () => {
        if (!S.tx.length) return toast('No hay movimientos que exportar');
        await app.saveFile(`movimientos-${todayStr()}.csv`, toCSV(S), 'text/csv');
      }),
      action('Importar movimientos desde CSV', 'De tu banco, de otra app o de una exportación anterior.', importCSVFlow)),
    card('Zona peligrosa',
      action('Borrar todos los datos', 'Elimina todo de este móvil. No se puede deshacer.', async () => {
        if (!(await confirmDialog('¿Borrar TODOS los datos de la app en este móvil? No se puede deshacer.', { ok: 'Borrar todo', danger: true }))) return;
        if (!(await confirmDialog('Última confirmación: se borrarán cuentas, movimientos y ajustes.', { ok: 'Sí, borrar', danger: true }))) return;
        app.wipe();
      }, 'danger-row')));
}

async function restoreFlow() {
  const file = await app.pickFile('.json,application/json');
  if (!file) return;
  openForm({
    title: 'Restaurar copia',
    intro: `Archivo: ${file.name}. Se sustituirán TODOS los datos actuales por los de la copia. Escribe la contraseña que tenía la app cuando se creó esa copia.`,
    fields: [{ key: 'pw', label: 'Contraseña de la copia', type: 'password', required: true, autocomplete: 'off', autofocus: true }],
    onSave: async (o) => {
      const res = await app.restoreBackup(file, o.pw);
      if (res !== true) return res;
      resetNav(); render(); toast('Copia restaurada correctamente');
    },
  });
}

async function importCSVFlow() {
  const file = await app.pickFile('.csv,text/csv,text/plain');
  if (!file) return;
  if (file.size > 5e6) return toast('El archivo es demasiado grande (máximo 5 MB)');
  let rows;
  try { rows = parseCSV(await file.text()); } catch { return toast('No se ha podido leer el archivo'); }
  if (rows.length < 2) return toast('El archivo no tiene datos');
  const S = app.state;
  const snapshot = JSON.stringify(S);
  const finish = (res) => {
    changed();
    toast(`Importados: ${res.added} · repetidos saltados: ${res.skipped} · filas no válidas: ${res.errors}`,
      res.added ? { action: 'Deshacer', onAction: () => { app.state = JSON.parse(snapshot); changed(); } } : {});
  };
  if (isOwnCSV(rows[0])) {
    if (!(await confirmDialog(`El archivo tiene ${rows.length - 1} movimientos con el formato de esta app. ¿Importarlos? Los que ya existan se saltarán.`, { ok: 'Importar' }))) return;
    return finish(importOwnCSV(S, rows));
  }
  const header = rows[0];
  const opts = header.map((hd, i) => [String(i), hd || `Columna ${i + 1}`]);
  const guess = (re) => { const i = header.findIndex((x) => re.test(x.toLowerCase())); return i < 0 ? '' : String(i); };
  const accs = S.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name]);
  if (!accs.length) return toast('Primero crea una cuenta');
  openForm({
    title: 'Importar CSV',
    intro: `${rows.length - 1} filas. Primera fila de datos: ${rows[1].join(' | ').slice(0, 160)}. Indica qué columna es cada cosa.`,
    values: { dateCol: guess(/fecha|date/) || '0', amountCol: guess(/importe|amount|cantidad|monto|valor/) || '1', descCol: guess(/concepto|descrip|nota|note|memo|detalle/), catCol: guess(/categor/), dup: 'skip' },
    fields: [
      { key: 'dateCol', label: 'Columna de la fecha', type: 'select', options: opts },
      { key: 'amountCol', label: 'Columna del importe', type: 'select', options: opts, hint: 'Importe negativo = gasto; positivo = ingreso.' },
      { key: 'descCol', label: 'Columna de la descripción', type: 'select', options: [['', '(ninguna)'], ...opts] },
      { key: 'catCol', label: 'Columna de la categoría', type: 'select', options: [['', '(ninguna)'], ...opts] },
      { key: 'accountId', label: 'Guardar en la cuenta', type: 'select', options: accs },
      { key: 'dup', label: 'Movimientos repetidos', type: 'select', options: [['skip', 'Saltar los que ya existen'], ['keep', 'Importarlos igualmente']] },
    ],
    validate: (o) => (o.dateCol === o.amountCol ? 'La fecha y el importe no pueden ser la misma columna.' : null),
    onSave: (o) => {
      const res = importGenericCSV(S, rows, {
        dateCol: Number(o.dateCol), amountCol: Number(o.amountCol), descCol: o.descCol == null ? -1 : Number(o.descCol),
        catCol: o.catCol == null ? -1 : Number(o.catCol), accountId: o.accountId, skipDup: o.dup === 'skip',
      });
      if (!res.added && !res.skipped) return 'No se ha podido leer ninguna fila. Revisa que las columnas de fecha e importe sean las correctas.';
      finish(res);
    },
  });
}

// ---------- Ajustes ----------
function settingsView() {
  const S = app.state.settings;
  const sel = (label, key, options, after) => {
    const el = h('select', { onchange: () => { S[key] = typeof S[key] === 'number' ? Number(el.value) : el.value; app.save(); after && after(); render(); } },
      options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = String(S[key]);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  };
  return subPage('Ajustes y seguridad',
    card('Apariencia',
      sel('Moneda', 'currency', [['EUR', 'Euro (€)'], ['USD', 'Dólar ($)'], ['GBP', 'Libra (£)'], ['MXN', 'Peso mexicano'], ['CHF', 'Franco suizo']]),
      sel('Tema', 'theme', [['auto', 'Automático (como el móvil)'], ['light', 'Claro'], ['dark', 'Oscuro']], () => app.applyTheme())),
    card('Seguridad',
      sel('Bloquear al salir de la app', 'autoLockMin', [['0', 'Inmediatamente'], ['1', 'Tras 1 minuto'], ['5', 'Tras 5 minutos'], ['15', 'Tras 15 minutos']]),
      app.bioSupported && h('button', { type: 'button', class: 'btn block', onclick: app.bioEnabled ? disableBioFlow : enableBioFlow },
        app.bioEnabled ? 'Desactivar Face ID' : 'Activar Face ID'),
      h('button', { type: 'button', class: 'btn block', onclick: changePasswordFlow }, 'Cambiar contraseña'),
      h('p', { class: 'help' }, app.bioSupported
        ? 'Con Face ID activado, cualquiera que pueda desbloquear tu móvil (con tu cara o con el código) podrá abrir la app. La contraseña sigue funcionando siempre.'
        : 'Este navegador no permite desbloquear con Face ID.')));
}

function enableBioFlow() {
  openForm({
    title: 'Activar Face ID',
    intro: 'Escribe tu contraseña para confirmar. Después podrás abrir la app con Face ID (o Touch ID / huella). La contraseña seguirá funcionando: no la olvides.',
    fields: [{ key: 'pw', label: 'Contraseña', type: 'password', required: true, autocomplete: 'current-password', autofocus: true }],
    onSave: async (o) => {
      const res = await app.enableBio(o.pw);
      if (res !== true) return res;
      render(); toast('Face ID activado');
    },
  });
}

async function disableBioFlow() {
  if (!(await confirmDialog('¿Desactivar Face ID? Tendrás que escribir la contraseña para entrar.', { ok: 'Desactivar' }))) return;
  await app.disableBio();
  render(); toast('Face ID desactivado');
}

function changePasswordFlow() {
  openForm({
    title: 'Cambiar contraseña',
    intro: 'Recuerda: si olvidas la contraseña nadie puede recuperarla ni recuperar tus datos. Las copias de seguridad antiguas seguirán abriéndose con la contraseña antigua.',
    fields: [
      { key: 'old', label: 'Contraseña actual', type: 'password', required: true, autocomplete: 'current-password' },
      { key: 'pw', label: 'Contraseña nueva (mínimo 8 caracteres)', type: 'password', required: true, autocomplete: 'new-password' },
      { key: 'pw2', label: 'Repite la contraseña nueva', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    validate: (o) => (o.pw.length < 8 ? 'La contraseña nueva debe tener al menos 8 caracteres.' : o.pw !== o.pw2 ? 'Las dos contraseñas nuevas no coinciden.' : null),
    onSave: async (o) => {
      const res = await app.changePassword(o.old, o.pw);
      if (res !== true) return res;
      render(); toast('Contraseña cambiada. Si usabas Face ID, vuelve a activarlo.');
    },
  });
}

// ---------- Acerca de ----------
function aboutView() {
  const p = (t) => h('p', null, t);
  return subPage('Privacidad y acerca de',
    card('Tus datos son solo tuyos',
      p('• Todo se guarda únicamente en este móvil, cifrado con tu contraseña (AES-256).'),
      p('• No hay cuenta, ni servidor, ni anuncios, ni rastreadores, ni conexión con bancos.'),
      p('• La app tiene bloqueadas por diseño las conexiones a internet: no puede enviar tus datos a ningún sitio.'),
      p('• Nadie puede recuperar tu contraseña. Guárdala bien y haz copias de seguridad.')),
    card('Versión', p('Mis Finanzas ' + app.version)));
}

const TABS = { home: homeView, tx: txView, reports: reportsView, more: moreView };
const SUBS = { accounts: accountsView, categories: categoriesView, budgets: budgetsView, recurring: recurringView, goals: goalsView, debts: debtsView, data: dataView, settings: settingsView, about: aboutView };
