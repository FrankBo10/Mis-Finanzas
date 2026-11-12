// Todas las pantallas de la app.
import { h, $, uid, todayStr, addMonthsYm, monthLabel, dayLabel, shortDate, money, centsToInput, parseAmount } from './util.js';
import {
  balances, monthTotals, byCategory, spentInCategory, netWorthSeries, toCSV, parseCSV, isOwnCSV, importOwnCSV,
  importGenericCSV, PALETTE, ACCOUNT_TYPES, ACCOUNT_ICONS, txParts, runningBalances, allTags, parseTags, byTag, TRASH_DAYS,
  isPending, budgetStatus, applyRules, txOfCategory, FEE_CATEGORY,
} from './model.js';
import { donut, bars, line } from './charts.js';
import { openForm, openSheet, toast, confirmDialog } from './forms.js';

let app;
const nav = { tab: 'home', sub: null, month: todayStr().slice(0, 7), search: '', filterAcc: '', filterTag: '', filterCat: '', repKind: 'expense',
  repMode: 'month', repYear: todayStr().slice(0, 4), repFrom: todayStr().slice(0, 8) + '01', repTo: todayStr() };

export function initViews(a) { app = a; }
export function resetNav() { Object.assign(nav, { tab: 'home', sub: null, month: todayStr().slice(0, 7), search: '', filterAcc: '', filterTag: '', filterCat: '' }); }
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

const catOf = (id) => app.state.categories.find((c) => c.id === id);

// Fila de un movimiento. "saldo" (opcional) es el saldo acumulado que quedó tras él.
function txRow(t, saldo, onclick) {
  const isTr = t.type === 'transfer';
  const parts = txParts(t);
  const split = parts.length > 1;
  const cat = split ? null : catOf(parts[0].categoryId);
  const title = isTr ? `${accName(t.accountId)} → ${accName(t.toAccountId)}`
    : split ? parts.map((p) => catOf(p.categoryId)?.name || 'Sin categoría').join(' + ')
    : cat?.name || 'Sin categoría';
  const sub = [
    !isTr && accName(t.accountId),
    split && `dividido en ${parts.length}`,
    isTr && t.fee ? `comisión ${fmt(t.fee)}` : null,
    t.note,
    (t.tags || []).map((x) => '#' + x).join(' '),
    t.recurringId && '🔁',
    isPending(t) && '⏳ pendiente',
  ].filter(Boolean).join(' · ');
  const sign = t.type === 'expense' ? '−' : t.type === 'income' ? '+' : '';
  return h('button', { type: 'button', class: 'row', onclick: onclick || (() => editTx(t)) },
    h('span', { class: 'ico' }, isTr ? '↔️' : split ? '🧩' : cat?.icon || '❔'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub && h('span', { class: 'row-sub' }, sub)),
    h('span', { class: 'amt-col' },
      h('span', { class: 'amt ' + t.type }, sign + fmt(t.amount)),
      saldo != null && h('span', { class: 'saldo' }, fmt(saldo))));
}

function progress(pct) {
  const fill = h('div', { class: 'bar-fill' + (pct > 1 ? ' over' : pct > 0.85 ? ' warn' : '') });
  fill.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
  return h('div', { class: 'bar' }, fill);
}

function budgetRow(b, ym) {
  const c = catOf(b.categoryId);
  if (!c) return null;
  const st = budgetStatus(app.state, b, ym);
  const carry = st.carry > 0 ? ` · incluye ${fmt(st.carry)} que sobraron de meses anteriores`
    : st.carry < 0 ? ` · se han restado ${fmt(-st.carry)} por pasarte en meses anteriores` : '';
  return h('button', { type: 'button', class: 'stack-row', onclick: () => editBudget(b) },
    h('div', { class: 'split' }, h('span', null, `${c.icon} ${c.name}`), h('span', null, `${fmt(st.spent)} / ${fmt(st.limit)}`)),
    progress(st.limit > 0 ? st.spent / st.limit : st.spent > 0 ? 2 : 0),
    h('div', { class: 'row-sub wrap' }, (st.spent > st.limit ? `Te has pasado ${fmt(st.spent - st.limit)}` : `Te quedan ${fmt(st.limit - st.spent)}`) + carry));
}

// Fila del presupuesto total del mes (todos los gastos juntos).
function totalBudgetRow(ym) {
  const S = app.state, limit = S.settings.totalBudget;
  if (!limit) return null;
  const spent = monthTotals(S, ym).expense;
  return h('button', { type: 'button', class: 'stack-row', onclick: editTotalBudget },
    h('div', { class: 'split' }, h('b', null, 'Total del mes'), h('span', null, `${fmt(spent)} / ${fmt(limit)}`)),
    progress(spent / limit),
    h('div', { class: 'row-sub' }, spent > limit ? `Te has pasado ${fmt(spent - limit)}` : `Te quedan ${fmt(limit - spent)}`));
}

function editTotalBudget() {
  const S = app.state.settings;
  openForm({
    title: 'Presupuesto total',
    intro: 'Un límite para todos tus gastos del mes juntos. Déjalo vacío si no quieres usarlo.',
    values: { v: S.totalBudget },
    fields: [{ key: 'v', label: 'Límite total al mes', type: 'money', autofocus: true }],
    onSave: (o) => { S.totalBudget = o.v > 0 ? o.v : null; changed(); },
  });
}

// Crea un movimiento con fecha de hoy a partir de una plantilla.
function useTemplate(tp) {
  const S = app.state;
  const has = (id) => S.accounts.some((a) => a.id === id && !a.archived);
  if (!has(tp.accountId) || (tp.type === 'transfer' && !has(tp.toAccountId))) return toast('La cuenta de esta plantilla ya no existe. Edita la plantilla en Más → Plantillas.');
  const t = {
    id: uid(), ts: Date.now(), type: tp.type, amount: tp.amount, accountId: tp.accountId, date: todayStr(), note: tp.note || '',
    toAccountId: tp.type === 'transfer' ? tp.toAccountId : null, fee: null, splits: null,
    categoryId: tp.type !== 'transfer' && catOf(tp.categoryId) ? tp.categoryId : null, tags: [...(tp.tags || [])],
  };
  S.tx.push(t);
  changed();
  toast(`Apuntado: ${tp.name} · ${fmt(tp.amount)}`, { action: 'Deshacer', onAction: () => {
    const T = app.state, i = T.tx.indexOf(t);
    if (i >= 0) { T.tx.splice(i, 1); changed(); }
  } });
}

// ================= INICIO =================
function homeView() {
  const S = app.state, bal = balances(S), today = todayStr(), ym = today.slice(0, 7);
  const active = S.accounts.filter((a) => !a.archived);
  const total = active.reduce((s, a) => s + bal.get(a.id), 0);
  const mt = monthTotals(S, ym);
  const last = S.settings.lastBackupAt;
  const needBackup = S.tx.length >= 5 && (!last || Date.now() - last > 30 * 864e5);
  const recent = S.tx.filter((t) => !isPending(t, today)).sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0)).slice(0, 6);
  const upcoming = S.recurring.filter((r) => r.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 3);
  const pending = S.tx.filter((t) => isPending(t, today)).sort((a, b) => a.date.localeCompare(b.date));

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
    S.templates.length ? card('Plantillas · un toque para apuntar', h('div', { class: 'chips pad-chips' },
      S.templates.map((tp) => h('button', { type: 'button', class: 'chip big', onclick: () => useTemplate(tp) }, `${tp.name} · ${fmt(tp.amount)}`)))) : null,
    S.budgets.length || S.settings.totalBudget ? card('Presupuestos de este mes', totalBudgetRow(ym), S.budgets.map((b) => budgetRow(b, ym))) : null,
    pending.length ? card('Pendientes · aún no cuentan en el saldo', pending.slice(0, 5).map((t) => txRow(t)),
      h('p', { class: 'help' }, (pending.length === 1 ? '1 movimiento' : `${pending.length} movimientos`) + ' con fecha futura. Contarán cuando llegue su día.')) : null,
    upcoming.length ? card('Próximos recurrentes', upcoming.map((r) => h('div', { class: 'row static' },
      h('span', { class: 'ico' }, '🔁'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.note || recurringTitle(r)), h('span', { class: 'row-sub' }, shortDate(r.nextDate))),
      h('span', { class: 'amt ' + r.type }, fmt(r.amount))))) : null,
    card('Últimos movimientos', recent.length ? recent.map((t) => txRow(t)) : empty('Todavía no hay movimientos. Pulsa el botón + para añadir el primero.')),
    h('p', { class: 'version' }, 'Mis Finanzas · versión ' + app.version));
}

// ================= MOVIMIENTOS =================
function txView() {
  const S = app.state;
  const list = h('div');
  const tags = allTags(S);
  if (nav.filterTag && !tags.includes(nav.filterTag)) nav.filterTag = '';
  const fill = () => {
    const q = nav.search.trim().toLowerCase();
    const running = runningBalances(S, nav.filterAcc); // saldo acumulado tras cada movimiento
    let items = S.tx.filter((t) => (q || t.date.startsWith(nav.month))
      && (!nav.filterAcc || t.accountId === nav.filterAcc || t.toAccountId === nav.filterAcc)
      && (!nav.filterTag || (t.tags || []).includes(nav.filterTag))
      && (!nav.filterCat || (t.type !== 'transfer' && txParts(t).some((p) => (p.categoryId || '__none') === nav.filterCat))));
    if (q) {
      items = items.filter((t) => {
        const cats = txParts(t).map((p) => catOf(p.categoryId)?.name || '');
        return [t.note || '', ...cats, ...(t.tags || []), accName(t.accountId), centsToInput(t.amount)].some((x) => x.toLowerCase().includes(q));
      });
    }
    items.sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
    const shown = items.slice(0, 400);
    const out = [];
    if (shown.length) out.push(h('p', { class: 'help' }, nav.filterAcc
      ? `El número gris bajo cada importe es el saldo de ${accName(nav.filterAcc)} después de ese movimiento.`
      : 'El número gris bajo cada importe es tu patrimonio total después de ese movimiento.'));
    else out.push(empty(q || nav.filterTag || nav.filterCat ? 'Ningún movimiento coincide.' : 'No hay movimientos en este mes.'));
    let day = null, box = null;
    for (const t of shown) {
      if (t.date !== day) {
        day = t.date;
        const net = items.filter((x) => x.date === day && !isPending(x)).reduce((s, x) => s + (x.type === 'income' ? x.amount : x.type === 'expense' ? -x.amount : -(x.fee || 0)), 0);
        box = h('section', { class: 'card' }, h('div', { class: 'split day-head' }, h('span', null, dayLabel(day)), h('span', null, fmt(net))));
        out.push(box);
      }
      box.append(txRow(t, running.get(t.id)));
    }
    if (items.length > shown.length) out.push(empty(`Se muestran los primeros ${shown.length} de ${items.length}. Afina la búsqueda para ver el resto.`));
    list.replaceChildren(...out);
  };
  const search = h('input', { type: 'search', placeholder: 'Buscar en todos los meses…', 'aria-label': 'Buscar movimientos', autocomplete: 'off', oninput: () => { nav.search = search.value; fill(); } });
  search.value = nav.search;
  const accSel = h('select', { 'aria-label': 'Filtrar por cuenta', onchange: () => { nav.filterAcc = accSel.value; fill(); } },
    h('option', { value: '' }, 'Todas las cuentas'), S.accounts.map((a) => h('option', { value: a.id }, a.name)));
  accSel.value = nav.filterAcc;
  const tagSel = tags.length ? h('select', { 'aria-label': 'Filtrar por etiqueta', onchange: () => { nav.filterTag = tagSel.value; fill(); } },
    h('option', { value: '' }, 'Todas las etiquetas'), tags.map((x) => h('option', { value: x }, '#' + x))) : null;
  if (tagSel) tagSel.value = nav.filterTag;
  if (nav.filterCat && nav.filterCat !== '__none' && !catOf(nav.filterCat)) nav.filterCat = '';
  const catSel = h('select', { 'aria-label': 'Filtrar por categoría', onchange: () => { nav.filterCat = catSel.value; fill(); } },
    h('option', { value: '' }, 'Todas las categorías'), S.categories.map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)), h('option', { value: '__none' }, 'Sin categoría'));
  catSel.value = nav.filterCat;
  fill();
  return page('Movimientos', monthNav(), h('div', { class: 'filters' }, search, accSel, catSel, tagSel), list);
}

// Manda un movimiento a la papelera (se puede recuperar durante 30 días).
function trashTx(t) {
  const S = app.state;
  const i = S.tx.indexOf(t);
  if (i < 0) return;
  S.tx.splice(i, 1);
  const entry = { tx: t, deletedAt: Date.now() };
  S.trash.push(entry);
  changed();
  toast('Movido a la papelera', { action: 'Deshacer', onAction: () => {
    const T = app.state, j = T.trash.indexOf(entry);
    if (j < 0) return;
    T.trash.splice(j, 1); T.tx.push(t); changed();
  } });
}

// Editor para repartir un movimiento entre varias categorías.
function openSplitEditor({ kind, total, splits, categoryId }, onDone) {
  const cats = app.state.categories.filter((c) => c.kind === kind && !c.archived);
  if (cats.length < 2) return toast('Necesitas al menos dos categorías de este tipo');
  const rows = [];
  const list = h('div');
  const sum = h('p', { class: 'split-sum' });
  const err = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const totalNow = () => rows.reduce((s, r) => s + Math.max(0, parseAmount(r.amt.value) || 0), 0);
  const update = () => { sum.textContent = `Total del movimiento: ${fmt(totalNow())}`; };
  const addRow = (catId, cents) => {
    const sel = h('select', { 'aria-label': 'Categoría' }, cats.map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)));
    sel.value = cats.some((c) => c.id === catId) ? catId : (cats.find((c) => !rows.some((r) => r.sel.value === c.id)) || cats[0]).id;
    const amt = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Importe de esta parte', autocomplete: 'off', oninput: update });
    if (cents) amt.value = centsToInput(cents);
    const row = { sel, amt };
    row.el = h('div', { class: 'split-row' }, sel, amt,
      h('button', { type: 'button', class: 'del', 'aria-label': 'Quitar esta parte', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); update(); } }, '✕'));
    rows.push(row); list.append(row.el);
  };
  if (splits && splits.length) splits.forEach((p) => addRow(p.categoryId, p.amount));
  else { addRow(categoryId, total); addRow(null, null); }
  update();
  const body = h('div', { class: 'form-body' },
    h('p', { class: 'form-intro' }, 'Reparte el importe entre varias categorías. Ejemplo: una compra de 80 € con 60 € de comida y 20 € de ropa. El importe total del movimiento será la suma de las partes.'),
    list,
    h('button', { type: 'button', class: 'btn block', onclick: () => addRow(null, null) }, '+ Añadir otra parte'),
    sum, err);
  openSheet({
    title: 'Dividir', body, saveLabel: 'Aceptar',
    onSave: (close) => {
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const merged = new Map();
      for (const r of rows) {
        if (r.amt.value.trim() === '') continue;
        const cents = parseAmount(r.amt.value);
        if (cents == null || cents <= 0) return fail('Hay un importe que no es válido. Ejemplo: 12,50');
        merged.set(r.sel.value, (merged.get(r.sel.value) || 0) + cents);
      }
      if (merged.size < 2) return fail('Pon importe en al menos dos categorías distintas.');
      close();
      onDone([...merged.entries()].map(([id, amount]) => ({ categoryId: id, amount })));
    },
  });
}

export function editTx(t, preset) {
  const S = app.state, isNew = !t;
  const accs = S.accounts.filter((a) => !a.archived || (t && (a.id === t.accountId || a.id === t.toAccountId))).map((a) => [a.id, a.name]);
  if (!accs.length) return toast('Primero crea una cuenta en Más → Cuentas');
  const values = t
    ? { ...t, categoryId: t.categoryId ?? '', splits: t.splits ? t.splits.map((p) => ({ ...p })) : null, tagsText: (t.tags || []).join(', ') }
    : { type: 'expense', date: todayStr(), accountId: S.settings.lastAccountId, note: '', splits: null, tagsText: '', ...(preset || {}) };
  if (isNew && preset?.toAccountId) {
    if (!values.accountId || values.accountId === preset.toAccountId) values.accountId = accs.find(([id]) => id !== preset.toAccountId)?.[0];
  } else if (isNew) values.toAccountId = accs.find(([id]) => id !== (values.accountId || accs[0][0]))?.[0];
  const known = allTags(S);
  openForm({
    title: isNew ? 'Nuevo movimiento' : 'Editar movimiento',
    values,
    // Si cambias de gasto a ingreso (o a transferencia), la división anterior ya no vale.
    onChange: (v) => { if (v.splits && (v.type === 'transfer' || v.splits.some((p) => catOf(p.categoryId)?.kind !== v.type))) v.splits = null; },
    fields: [
      { key: 'type', label: 'Tipo', type: 'seg', options: [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']] },
      { key: 'amount', label: 'Importe', type: 'money', required: true, positive: true, autofocus: isNew },
      { key: 'categoryId', label: 'Categoría', type: 'select', showIf: (v) => v.type !== 'transfer' && !v.splits,
        options: (v) => [...S.categories.filter((c) => c.kind === v.type && (!c.archived || c.id === values.categoryId)).map((c) => [c.id, `${c.icon} ${c.name}`]), ['', 'Sin categoría']] },
      { key: 'splits', type: 'custom', showIf: (v) => v.type !== 'transfer',
        render: (api) => {
          const v = api.vals;
          const open = () => openSplitEditor(
            { kind: v.type, total: parseAmount(api.input('amount').value) || null, splits: v.splits, categoryId: v.categoryId },
            (parts) => { v.splits = parts; api.input('amount').value = centsToInput(parts.reduce((s2, p) => s2 + p.amount, 0)); api.refresh(); });
          if (!v.splits) return h('button', { type: 'button', class: 'btn small', onclick: open }, 'Dividir entre varias categorías');
          return h('div', { class: 'split-box' },
            h('span', { class: 'field-label' }, 'Dividido entre categorías'),
            v.splits.map((p) => { const c = catOf(p.categoryId); return h('div', { class: 'split' }, h('span', null, c ? `${c.icon} ${c.name}` : 'Sin categoría'), h('span', null, fmt(p.amount))); }),
            h('div', { class: 'mini-btns' },
              h('button', { type: 'button', class: 'btn small', onclick: open }, 'Cambiar'),
              h('button', { type: 'button', class: 'btn small', onclick: () => { v.splits = null; api.refresh(); } }, 'Quitar división')));
        } },
      { key: 'accountId', label: 'Cuenta', type: 'select', options: accs },
      { key: 'toAccountId', label: 'Cuenta destino', type: 'select', showIf: (v) => v.type === 'transfer', options: accs },
      { key: 'fee', label: 'Comisión (opcional)', type: 'money', showIf: (v) => v.type === 'transfer', hint: 'Lo que te cobra el banco por la transferencia. Sale de la cuenta de origen y cuenta como gasto.' },
      { key: 'date', label: 'Fecha', type: 'date', required: true },
      { key: 'note', label: 'Nota (opcional)', type: 'text' },
      { key: 'tagsText', label: 'Etiquetas (opcional, separadas por comas)', type: 'text', placeholder: 'Ej.: vacaciones, coche', maxlength: 200 },
      { key: 'tagChips', type: 'custom',
        render: (api) => (known.length ? h('div', { class: 'chips' }, known.slice(0, 20).map((tag) => h('button', { type: 'button', class: 'chip', onclick: () => {
          const input = api.input('tagsText');
          const cur = parseTags(input.value);
          if (!cur.some((x) => x.toLowerCase() === tag.toLowerCase())) cur.push(tag);
          input.value = cur.join(', ');
        } }, '#' + tag))) : null) },
    ],
    validate: (o) => {
      if (o.type === 'transfer' && o.accountId === o.toAccountId) return 'La cuenta de origen y la de destino deben ser distintas.';
      if (o.splits) {
        const sum = o.splits.reduce((s2, p) => s2 + p.amount, 0);
        if (sum !== o.amount) return `Las partes de la división suman ${fmt(sum)}, pero el importe es ${fmt(o.amount)}. Cambia la división o quítala.`;
      }
      return null;
    },
    onSave: (o) => {
      const data = {
        type: o.type, amount: o.amount, accountId: o.accountId, date: o.date, note: o.note || '',
        toAccountId: o.type === 'transfer' ? o.toAccountId : null,
        fee: o.type === 'transfer' && o.fee > 0 ? o.fee : null,
        splits: o.type !== 'transfer' && o.splits ? o.splits : null,
        categoryId: o.type === 'transfer' || o.splits ? null : o.categoryId,
        tags: parseTags(o.tagsText),
      };
      if (isNew) S.tx.push({ id: uid(), ts: Date.now(), ...data }); else Object.assign(t, data);
      S.settings.lastAccountId = o.accountId;
      changed();
      toast(isNew ? 'Movimiento guardado' : 'Cambios guardados');
    },
    onDelete: isNew ? null : (close) => { close(); trashTx(t); },
    deleteLabel: 'Mover a la papelera',
    extraButtons: isNew ? [] : [{ label: 'Duplicar con fecha de hoy', onClick: (close) => {
      close();
      S.tx.push({ ...JSON.parse(JSON.stringify(t)), id: uid(), ts: Date.now(), date: todayStr(), recurringId: null });
      changed(); toast('Movimiento duplicado');
    } }, { label: 'Guardar como plantilla', onClick: (close) => {
      close();
      const cat = catOf(t.categoryId);
      editTemplate(null, { name: t.note || cat?.name || (t.type === 'transfer' ? 'Transferencia' : 'Plantilla'), type: t.type, amount: t.amount,
        categoryId: t.categoryId ?? '', accountId: t.accountId, toAccountId: t.toAccountId, note: t.note || '', tags: [...(t.tags || [])] });
    } }],
  });
}

// ================= INFORMES =================
function reportsView() {
  const S = app.state, kind = nav.repKind, mode = nav.repMode;
  // Periodo elegido, periodo anterior (para comparar) y su nombre.
  let per, prev = null, prevName = '', title, endYm;
  if (mode === 'year') { per = nav.repYear; prev = String(Number(per) - 1); prevName = 'al año anterior'; title = 'Año ' + per; endYm = per + '-12'; }
  else if (mode === 'range') {
    if (nav.repFrom > nav.repTo) [nav.repFrom, nav.repTo] = [nav.repTo, nav.repFrom];
    per = { from: nav.repFrom, to: nav.repTo }; title = `${shortDate(nav.repFrom)} – ${shortDate(nav.repTo)}`; endYm = nav.repTo.slice(0, 7);
  } else { per = nav.month; prev = addMonthsYm(per, -1); prevName = 'al mes anterior'; title = monthLabel(per); endYm = per; }
  const mt = monthTotals(S, per), pv = prev ? monthTotals(S, prev) : null;
  const cats = byCategory(S, per, kind);
  const total = cats.reduce((s, c) => s + c.total, 0);
  const diff = (now, before) => (!pv ? '' : before ? `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))} % respecto ${prevName}` : 'Sin datos del periodo anterior');
  const segBtn = (cur, set, opts) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { type: 'button', class: v === cur ? 'on' : '', onclick: () => { set(v); render(); } }, l)));
  const yearMove = (n) => () => { nav.repYear = String(Number(nav.repYear) + n); render(); };
  const dateInput = (key, label) => {
    const el = h('input', { type: 'date', 'aria-label': label, onchange: () => { if (el.value) { nav[key] = el.value; render(); } } });
    el.value = nav[key];
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  };
  const periodNav = mode === 'year'
    ? h('div', { class: 'month-nav' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Año anterior', onclick: yearMove(-1) }, '‹'),
      h('strong', null, 'Año ' + nav.repYear), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Año siguiente', onclick: yearMove(1) }, '›'))
    : mode === 'range' ? h('div', { class: 'grid2' }, dateInput('repFrom', 'Desde'), dateInput('repTo', 'Hasta'))
    : monthNav();
  const months = mode === 'year'
    ? Array.from({ length: 12 }, (_, i) => `${per}-${String(i + 1).padStart(2, '0')}`)
    : Array.from({ length: 6 }, (_, i) => addMonthsYm(endYm, i - 5));
  const monthData = months.map((m) => ({ ym: m, ...monthTotals(S, m) }));
  const tg = byTag(S, per);

  // Al tocar una categoría se abre la lista de sus movimientos en ese periodo.
  const openCategory = (c) => {
    const items = txOfCategory(S, per, kind, c.cat.id).sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
    const sheet = openSheet({ title: c.cat.name, cancelLabel: 'Cerrar', body: h('div', { class: 'form-body' },
      h('p', { class: 'form-intro' }, `${title} · ${items.length} movimientos · ${fmt(c.total)}`),
      h('section', { class: 'card' }, items.map((t) => txRow(t, null, () => { sheet.close(); editTx(t); })))) });
  };

  return page('Informes',
    segBtn(mode, (v) => { nav.repMode = v; }, [['month', 'Mes'], ['year', 'Año'], ['range', 'Fechas']]),
    h('div', { class: 'gap' }), periodNav,
    h('div', { class: 'grid2' },
      h('section', { class: 'card stat' }, h('span', null, 'Ingresos'), h('b', { class: 'income' }, fmt(mt.income)), pv && h('small', null, diff(mt.income, pv.income))),
      h('section', { class: 'card stat' }, h('span', null, 'Gastos'), h('b', null, fmt(mt.expense)), pv && h('small', null, diff(mt.expense, pv.expense)))),
    card('Ahorro del periodo', h('p', { class: 'big' + (mt.net < 0 ? ' expense' : ' income') }, fmt(mt.net)),
      mt.income > 0 && h('p', { class: 'row-sub' }, `Has ahorrado el ${Math.round((mt.net / mt.income) * 100)} % de tus ingresos.`)),
    card('Por categorías', segBtn(kind, (v) => { nav.repKind = v; }, [['expense', 'Gastos'], ['income', 'Ingresos']]),
      total ? [donut(cats.map((c) => ({ color: c.cat.color, value: c.total })), kind === 'expense' ? 'Gastos' : 'Ingresos', fmt(total)),
        cats.map((c) => {
          const dot = h('span', { class: 'dot' }); dot.style.background = c.cat.color;
          return h('button', { type: 'button', class: 'row', onclick: () => openCategory(c) }, dot,
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `${c.cat.icon} ${c.cat.name}`)),
            h('span', { class: 'amt' }, fmt(c.total), h('small', null, ` ${Math.round((c.total / total) * 100)} %`)), h('span', { class: 'chev' }, '›'));
        }),
        h('p', { class: 'help' }, 'Toca una categoría para ver sus movimientos.')] : empty('No hay datos en este periodo.')),
    tg.length ? card('Gastos por etiqueta', tg.map((x) => h('div', { class: 'row static' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, '#' + x.tag)), h('span', { class: 'amt' }, fmt(x.total)))),
      h('p', { class: 'help' }, 'Un movimiento con varias etiquetas cuenta en cada una.')) : null,
    card(mode === 'year' ? 'Mes a mes' : 'Últimos 6 meses', bars(monthData), h('p', { class: 'legend' }, h('span', { class: 'lg income' }, 'Ingresos'), h('span', { class: 'lg expense' }, 'Gastos'))),
    card('Evolución del patrimonio (12 meses)', line(netWorthSeries(S, endYm, 12))));
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
      item('🎯', 'Presupuestos', 'Límite de gasto mensual, total y por categoría', () => go('more', 'budgets')),
      item('🔁', 'Recurrentes', 'Alquiler, nómina, suscripciones…', () => go('more', 'recurring')),
      item('⚡', 'Plantillas', 'Movimientos frecuentes con un toque', () => go('more', 'templates')),
      item('🪄', 'Reglas de categorías', 'Categoría automática al importar del banco', () => go('more', 'rules')),
      item('🐖', 'Metas de ahorro', null, () => go('more', 'goals')),
      item('🤝', 'Deudas y préstamos', null, () => go('more', 'debts'))),
    card(null,
      item('🗑️', 'Papelera', S.trash.length ? `${S.trash.length} movimientos · se vacía sola a los ${TRASH_DAYS} días` : 'Vacía', () => go('more', 'trash')),
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
  const used = a && ([...S.tx, ...S.trash.map((x) => x.tx)].some((t) => t.accountId === a.id || t.toAccountId === a.id) || S.recurring.some((r) => r.accountId === a.id || r.toAccountId === a.id));
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
      if (used) return toast('Esta cuenta tiene movimientos (o los tiene en la papelera). No se puede borrar, pero puedes archivarla.');
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
      const n = S.tx.filter((t) => txParts(t).some((p) => p.categoryId === c.id)).length;
      const msg = n ? `¿Eliminar "${c.name}"? Sus ${n} movimientos NO se borran: quedarán como "Sin categoría".` : `¿Eliminar la categoría "${c.name}"?`;
      if (!(await confirmDialog(msg, { ok: 'Eliminar', danger: true }))) return;
      for (const t of [...S.tx, ...S.trash.map((x) => x.tx)]) {
        if (t.categoryId === c.id) t.categoryId = null;
        for (const part of t.splits || []) if (part.categoryId === c.id) part.categoryId = null;
      }
      for (const r of S.recurring) if (r.categoryId === c.id) r.categoryId = null;
      S.budgets = S.budgets.filter((b) => b.categoryId !== c.id);
      S.rules = S.rules.filter((r) => r.categoryId !== c.id);
      for (const tp of S.templates) if (tp.categoryId === c.id) tp.categoryId = null;
      S.categories.splice(S.categories.indexOf(c), 1); close(); changed();
    },
  });
}

// ---------- Presupuestos ----------
function budgetsView() {
  const S = app.state, ym = todayStr().slice(0, 7);
  const totalB = S.budgets.reduce((s, b) => s + b.amount, 0);
  return subPage('Presupuestos',
    h('p', { class: 'help' }, 'Pon un límite de gasto mensual. La barra se pone naranja al 85 % y roja si te pasas.'),
    card('Todos los gastos juntos', totalBudgetRow(ym) || empty('Sin presupuesto total.'),
      h('button', { type: 'button', class: 'btn small', onclick: editTotalBudget }, S.settings.totalBudget ? 'Cambiar presupuesto total' : 'Poner presupuesto total')),
    card(S.budgets.length ? `Por categoría · suman ${fmt(totalB)} al mes` : 'Por categoría', S.budgets.length ? S.budgets.map((b) => budgetRow(b, ym)) : empty('No hay presupuestos por categoría.')),
    addBtn('+ Nuevo presupuesto por categoría', () => editBudget()));
}

function editBudget(b) {
  const S = app.state, isNew = !b;
  const free = S.categories.filter((c) => c.kind === 'expense' && (c.id === b?.categoryId || (!c.archived && !S.budgets.some((x) => x.categoryId === c.id))));
  if (!free.length) return toast('Todas las categorías de gasto ya tienen presupuesto');
  openForm({
    title: isNew ? 'Nuevo presupuesto' : 'Editar presupuesto',
    values: b ? { ...b, rollover: b.rollover ? 'yes' : 'no' } : { rollover: 'no' },
    fields: [
      { key: 'categoryId', label: 'Categoría', type: 'select', options: free.map((c) => [c.id, `${c.icon} ${c.name}`]) },
      { key: 'amount', label: 'Límite mensual', type: 'money', required: true, positive: true, autofocus: isNew },
      { key: 'rollover', label: 'Lo que sobre o falte al acabar el mes', type: 'select', options: [['no', 'No se arrastra: cada mes empieza de cero'], ['yes', 'Se arrastra al mes siguiente']],
        hint: 'Con arrastre: si un mes te sobran 20 €, el siguiente tienes 20 € más; si te pasas 20 €, tienes 20 € menos. Empieza a contar desde el mes en que lo activas.' },
    ],
    onSave: (o) => {
      const rollover = o.rollover === 'yes';
      const data = { categoryId: o.categoryId, amount: o.amount, rollover, since: rollover ? (b?.rollover && b.since) || todayStr().slice(0, 7) : null };
      if (isNew) S.budgets.push({ id: uid(), ...data }); else Object.assign(b, data);
      changed();
    },
    onDelete: isNew ? null : (close) => { S.budgets.splice(S.budgets.indexOf(b), 1); close(); changed(); },
  });
}

// ---------- Plantillas ----------
function templatesView() {
  const S = app.state;
  const row = (tp) => h('button', { type: 'button', class: 'row', onclick: () => editTemplate(tp) },
    h('span', { class: 'ico' }, tp.type === 'transfer' ? '↔️' : catOf(tp.categoryId)?.icon || '⚡'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, tp.name),
      h('span', { class: 'row-sub' }, tp.type === 'transfer' ? `${accName(tp.accountId)} → ${accName(tp.toAccountId)}` : `${catOf(tp.categoryId)?.name || 'Sin categoría'} · ${accName(tp.accountId)}`)),
    h('span', { class: 'amt ' + tp.type }, fmt(tp.amount)));
  return subPage('Plantillas',
    h('p', { class: 'help' }, 'Movimientos que repites a menudo (un café, gasolina…). Aparecen en Inicio y con un toque quedan apuntados con la fecha de hoy. También puedes crear una desde un movimiento: ábrelo y pulsa "Guardar como plantilla".'),
    card(null, S.templates.length ? S.templates.map(row) : empty('No hay plantillas todavía.')),
    addBtn('+ Nueva plantilla', () => editTemplate()));
}

function editTemplate(tp, preset) {
  const S = app.state, isNew = !tp;
  const accs = S.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name]);
  if (!accs.length) return toast('Primero crea una cuenta');
  const base = tp || preset;
  openForm({
    title: isNew ? 'Nueva plantilla' : 'Editar plantilla',
    values: base ? { ...base, categoryId: base.categoryId ?? '' } : { type: 'expense', toAccountId: accs[1]?.[0], note: '' },
    fields: [
      { key: 'name', label: 'Nombre de la plantilla', required: true, placeholder: 'Ej.: Café', maxlength: 30, autofocus: isNew && !preset },
      { key: 'type', label: 'Tipo', type: 'seg', options: [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']] },
      { key: 'amount', label: 'Importe', type: 'money', required: true, positive: true },
      { key: 'categoryId', label: 'Categoría', type: 'select', showIf: (v) => v.type !== 'transfer',
        options: (v) => [...S.categories.filter((c) => c.kind === v.type && !c.archived).map((c) => [c.id, `${c.icon} ${c.name}`]), ['', 'Sin categoría']] },
      { key: 'accountId', label: 'Cuenta', type: 'select', options: accs },
      { key: 'toAccountId', label: 'Cuenta destino', type: 'select', showIf: (v) => v.type === 'transfer', options: accs },
      { key: 'note', label: 'Nota (opcional)', type: 'text' },
    ],
    validate: (o) => (o.type === 'transfer' && o.accountId === o.toAccountId ? 'La cuenta de origen y la de destino deben ser distintas.' : null),
    onSave: (o) => {
      const data = { ...o, note: o.note || '', tags: base?.tags || [] };
      if (isNew) S.templates.push({ id: uid(), ...data }); else Object.assign(tp, data);
      changed();
      if (isNew) toast('Plantilla guardada. La tienes en Inicio.');
    },
    onDelete: isNew ? null : (close) => { S.templates.splice(S.templates.indexOf(tp), 1); close(); changed(); },
  });
}

// ---------- Reglas de categorías ----------
function rulesView() {
  const S = app.state;
  const row = (r) => {
    const c = catOf(r.categoryId);
    return h('button', { type: 'button', class: 'row', onclick: () => editRule(r) },
      h('span', { class: 'ico' }, c?.icon || '❔'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `Contiene "${r.text}"`), h('span', { class: 'row-sub' }, `→ ${c?.name || '(categoría eliminada)'} · ${c?.kind === 'income' ? 'ingresos' : 'gastos'}`)),
      h('span', { class: 'chev' }, '›'));
  };
  return subPage('Reglas de categorías',
    h('p', { class: 'help' }, 'Al importar el CSV del banco, si la descripción de un movimiento contiene el texto de una regla, se le pone esa categoría sola. Ejemplo: contiene "mercadona" → Comida. No distingue mayúsculas; si coinciden varias, gana la primera de la lista.'),
    card(null, S.rules.length ? S.rules.map(row) : empty('No hay reglas todavía.')),
    addBtn('+ Nueva regla', () => editRule()),
    S.rules.length ? h('button', { type: 'button', class: 'btn block', onclick: () => {
      const n = applyRules(S);
      if (n) changed();
      toast(n ? `Se ha puesto categoría a ${n} movimientos` : 'Ningún movimiento sin categoría coincide con las reglas');
    } }, 'Aplicar ahora a los movimientos sin categoría') : null);
}

function editRule(r) {
  const S = app.state, isNew = !r;
  const cats = S.categories.filter((c) => !c.archived || c.id === r?.categoryId).map((c) => [c.id, `${c.icon} ${c.name} (${c.kind === 'income' ? 'ingreso' : 'gasto'})`]);
  if (!cats.length) return toast('Primero crea una categoría');
  openForm({
    title: isNew ? 'Nueva regla' : 'Editar regla',
    values: r ? { ...r } : {},
    fields: [
      { key: 'text', label: 'Si la descripción contiene…', required: true, placeholder: 'Ej.: mercadona', maxlength: 60, autofocus: isNew },
      { key: 'categoryId', label: '…poner la categoría', type: 'select', options: cats },
    ],
    onSave: (o) => { if (isNew) S.rules.push({ id: uid(), ...o }); else Object.assign(r, o); changed(); },
    onDelete: isNew ? null : (close) => { S.rules.splice(S.rules.indexOf(r), 1); close(); changed(); },
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
      { key: 'fee', label: 'Comisión (opcional)', type: 'money', showIf: (v) => v.type === 'transfer' },
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
// Lo ahorrado en una meta: si está vinculada a una cuenta, es el saldo de esa cuenta.
function goalSaved(g, bal) {
  return g.accountId && bal.has(g.accountId) ? Math.max(0, bal.get(g.accountId)) : g.saved || 0;
}

function goalsView() {
  const S = app.state, bal = balances(S);
  const row = (g) => {
    const linked = g.accountId && bal.has(g.accountId);
    const saved = goalSaved(g, bal);
    return h('div', { class: 'stack-row static' },
      h('div', { class: 'split' }, h('b', null, g.name), h('span', null, `${fmt(saved)} / ${fmt(g.target)}`)),
      progressGoal(g.target ? saved / g.target : 0),
      h('div', { class: 'row-sub wrap' }, (saved >= g.target ? '🎉 ¡Meta conseguida!' : `Faltan ${fmt(g.target - saved)}`)
        + (g.deadline ? ` · fecha límite: ${shortDate(g.deadline)}` : '') + (linked ? ` · es el saldo de la cuenta ${accName(g.accountId)}` : '')),
      h('div', { class: 'mini-btns' },
        h('button', { type: 'button', class: 'btn small', onclick: () => (linked
          ? editTx(null, { type: 'transfer', toAccountId: g.accountId, note: `Ahorro: ${g.name}` })
          : contribute(g, 'saved', 'Aportar a la meta', 'Cantidad a añadir (negativa para retirar)')) }, 'Aportar'),
        h('button', { type: 'button', class: 'btn small', onclick: () => editGoal(g) }, 'Editar')));
  };
  return subPage('Metas de ahorro',
    h('p', { class: 'help' }, 'Apunta para qué ahorras. Si vinculas la meta a una cuenta (por ejemplo una de ahorro), lo ahorrado es el saldo de esa cuenta y "Aportar" crea una transferencia hacia ella. Sin cuenta vinculada es un contador que llevas a mano.'),
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
    title: isNew ? 'Nueva meta' : 'Editar meta', values: g ? { ...g, accountId: g.accountId ?? '' } : { saved: 0, accountId: '' },
    fields: [
      { key: 'name', label: 'Nombre', required: true, placeholder: 'Ej.: Vacaciones', maxlength: 60, autofocus: isNew },
      { key: 'target', label: 'Objetivo', type: 'money', required: true, positive: true },
      { key: 'accountId', label: 'Cuenta vinculada', type: 'select',
        options: [['', 'Ninguna: lo apunto a mano'], ...S.accounts.filter((a) => !a.archived || a.id === g?.accountId).map((a) => [a.id, a.name])],
        hint: 'Si eliges una cuenta, lo ahorrado será siempre el saldo de esa cuenta.' },
      { key: 'saved', label: 'Ahorrado hasta ahora', type: 'money', showIf: (v) => !v.accountId },
      { key: 'deadline', label: 'Fecha límite (opcional)', type: 'date' },
    ],
    onSave: (o) => {
      const data = { name: o.name, target: o.target, accountId: o.accountId || null, deadline: o.deadline || null, saved: o.accountId ? g?.saved || 0 : o.saved || 0 };
      if (isNew) S.goals.push({ id: uid(), ...data }); else Object.assign(g, data);
      changed();
    },
    onDelete: isNew ? null : async (close) => {
      if (!(await confirmDialog(`¿Eliminar la meta "${g.name}"? No se borra ninguna cuenta ni movimiento.`, { ok: 'Eliminar', danger: true }))) return;
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
      h('button', { type: 'button', class: 'btn small', onclick: () => payDebt(d) }, 'Registrar pago'),
      h('button', { type: 'button', class: 'btn small', onclick: () => editDebt(d) }, 'Editar')));
  return subPage('Deudas y préstamos',
    h('p', { class: 'help' }, 'Lleva la cuenta de lo que debes y de lo que te deben. Al registrar un pago puedes elegir una cuenta para que se apunte también como gasto o ingreso.'),
    S.debts.length ? h('div', { class: 'grid2' },
      h('section', { class: 'card stat' }, h('span', null, 'Debo'), h('b', { class: 'expense' }, fmt(pending('owe')))),
      h('section', { class: 'card stat' }, h('span', null, 'Me deben'), h('b', { class: 'income' }, fmt(pending('owed'))))) : null,
    card(null, S.debts.length ? S.debts.map(row) : empty('No hay deudas apuntadas.')), addBtn('+ Nueva deuda', () => editDebt()));
}
function payDebt(d) {
  const S = app.state;
  const owe = d.direction === 'owe';
  openForm({
    title: 'Registrar pago',
    values: { accountId: '' },
    fields: [
      { key: 'v', label: owe ? 'Cantidad que has pagado' : 'Cantidad que te han pagado', type: 'money', required: true, positive: true, autofocus: true },
      { key: 'accountId', label: owe ? '¿De qué cuenta ha salido el dinero?' : '¿En qué cuenta ha entrado el dinero?', type: 'select',
        options: [['', 'No apuntarlo en ninguna cuenta'], ...S.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name])],
        hint: owe ? 'Si eliges una cuenta, se crea también un gasto en ella.' : 'Si eliges una cuenta, se crea también un ingreso en ella.' },
    ],
    onSave: (o) => {
      d.paid = (d.paid || 0) + o.v;
      if (o.accountId) {
        S.tx.push({ id: uid(), ts: Date.now(), type: owe ? 'expense' : 'income', amount: o.v, accountId: o.accountId, toAccountId: null,
          categoryId: null, date: todayStr(), note: `${owe ? 'Pago de deuda' : 'Cobro de deuda'}: ${d.name}`, tags: [] });
      }
      changed();
      toast(o.accountId ? 'Pago registrado y apuntado en la cuenta' : 'Pago registrado');
    },
  });
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

// ---------- Papelera ----------
function trashView() {
  const S = app.state;
  const items = [...S.trash].sort((a, b) => b.deletedAt - a.deletedAt);
  const restore = (x) => {
    const t = x.tx;
    if (!S.accounts.some((a) => a.id === t.accountId) || (t.type === 'transfer' && !S.accounts.some((a) => a.id === t.toAccountId))) {
      return toast('No se puede recuperar: su cuenta ya no existe.');
    }
    S.trash.splice(S.trash.indexOf(x), 1); S.tx.push(t); changed(); toast('Movimiento recuperado');
  };
  const openItem = (x) => {
    const days = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - x.deletedAt) / 864e5));
    const sheet = openSheet({ title: 'En la papelera', cancelLabel: 'Cerrar', body: h('div', { class: 'form-body' },
      h('section', { class: 'card' }, txRow(x.tx, null, () => {})),
      h('p', { class: 'form-intro' }, `Fecha del movimiento: ${shortDate(x.tx.date)}. Se borrará para siempre en ${days} días.`),
      h('button', { type: 'button', class: 'btn block primary', onclick: () => { sheet.close(); restore(x); } }, 'Recuperar'),
      h('button', { type: 'button', class: 'btn block danger', onclick: async () => {
        if (!(await confirmDialog('¿Borrar este movimiento para siempre?', { ok: 'Borrar', danger: true }))) return;
        sheet.close(); S.trash.splice(S.trash.indexOf(x), 1); changed();
      } }, 'Borrar para siempre')) });
  };
  return subPage('Papelera',
    h('p', { class: 'help' }, `Los movimientos que borras se guardan aquí ${TRASH_DAYS} días por si te equivocas. No cuentan en saldos ni informes. Toca uno para recuperarlo.`),
    card(null, items.length ? items.map((x) => txRow(x.tx, null, () => openItem(x))) : empty('La papelera está vacía.')),
    items.length ? h('button', { type: 'button', class: 'btn block danger', onclick: async () => {
      if (!(await confirmDialog(`¿Borrar para siempre los ${items.length} movimientos de la papelera?`, { ok: 'Vaciar', danger: true }))) return;
      S.trash = []; changed();
    } }, 'Vaciar papelera') : null);
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
    card('Exportación completa',
      action('Exportar todo sin cifrar (JSON)', 'Todos tus datos en un formato abierto, para llevártelos a otra app. ⚠️ Cualquiera que abra ese archivo los puede leer.', async () => {
        if (!(await confirmDialog('Este archivo contendrá TODOS tus datos SIN cifrar: cualquiera que lo tenga podrá leerlos. Úsalo solo si lo necesitas y bórralo después. Para guardar una copia, usa la copia de seguridad cifrada.', { ok: 'Exportar igualmente', danger: true }))) return;
        const { settings, ...rest } = S;
        await app.saveFile(`mis-finanzas-datos-${todayStr()}.json`, JSON.stringify({ app: 'mis-finanzas', formato: 'datos sin cifrar', nota: 'Importes en céntimos (1250 = 12,50)', moneda: settings.currency, ...rest }, null, 2), 'application/json');
      })),
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
    toast(`Importados: ${res.added} · repetidos saltados: ${res.skipped} · filas no válidas: ${res.errors}` + (res.auto ? ` · con categoría automática: ${res.auto}` : ''),
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
    validate: (o) => {
      const st = app.passwordStrength(o.pw);
      return st.score === 0 ? `Contraseña nueva: ${st.label.toLowerCase()}. ${st.tip}` : o.pw !== o.pw2 ? 'Las dos contraseñas nuevas no coinciden.' : null;
    },
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
    card('Versión', p('Mis Finanzas ' + app.version),
      h('button', { type: 'button', class: 'btn block', onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = 'Buscando…';
        let msg;
        try { msg = await app.searchUpdate(); } catch { msg = 'No se ha podido comprobar.'; }
        btn.disabled = false; btn.textContent = 'Buscar actualizaciones';
        toast(msg);
      } }, 'Buscar actualizaciones'),
      h('p', { class: 'help' }, 'Necesita internet solo para descargar la versión nueva de la app. Tus datos no se envían ni se tocan.')));
}

const TABS = { home: homeView, tx: txView, reports: reportsView, more: moreView };
const SUBS = { accounts: accountsView, categories: categoriesView, budgets: budgetsView, recurring: recurringView, templates: templatesView, rules: rulesView, trash: trashView, goals: goalsView, debts: debtsView, data: dataView, settings: settingsView, about: aboutView };
