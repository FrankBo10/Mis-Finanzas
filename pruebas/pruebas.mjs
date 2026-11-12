// Pruebas automáticas de los cálculos. Se ejecutan en el ordenador con:
//   node pruebas/pruebas.mjs
// (No forman parte de la app; sirven para comprobar que las cuentas salen bien.)
import assert from 'node:assert/strict';
import { parseAmount, addInterval, parseDateFlexible } from '../js/util.js';
import { newState, balances, monthTotals, runRecurring, toCSV, parseCSV, importOwnCSV, importGenericCSV, isOwnCSV, netWorthSeries } from '../js/model.js';

// Importes
assert.equal(parseAmount('12,50'), 1250);
assert.equal(parseAmount('12.50'), 1250);
assert.equal(parseAmount('1.234,56'), 123456);
assert.equal(parseAmount('1,234.56'), 123456);
assert.equal(parseAmount('1.234'), 123400);
assert.equal(parseAmount('-45,30 €'), -4530);
assert.equal(parseAmount('0,1') + parseAmount('0,2'), 30); // sin errores de decimales
assert.equal(parseAmount('abc'), null);
assert.equal(parseAmount(''), null);

// Fechas
assert.equal(addInterval('2026-01-31', 'monthly', 1, 31), '2026-02-28');
assert.equal(addInterval('2026-02-28', 'monthly', 1, 31), '2026-03-31');
assert.equal(addInterval('2024-02-29', 'yearly', 1, 29), '2025-02-28');
assert.equal(addInterval('2026-12-30', 'weekly', 1), '2027-01-06');
assert.equal(parseDateFlexible('03/11/2026'), '2026-11-03');
assert.equal(parseDateFlexible('2026-11-03'), '2026-11-03');
assert.equal(parseDateFlexible('31/02/2026'), null);

// Saldos
const S = newState();
const [cash, bank] = S.accounts;
bank.initial = 100000;
const cat = S.categories[0].id;
S.tx.push({ id: '1', type: 'expense', amount: 1250, accountId: cash.id, categoryId: cat, date: '2026-11-01', note: 'pan; "integral"' });
S.tx.push({ id: '2', type: 'income', amount: 200000, accountId: bank.id, categoryId: null, date: '2026-11-02', note: '=SUMA(A1)' });
S.tx.push({ id: '3', type: 'transfer', amount: 5000, accountId: bank.id, toAccountId: cash.id, date: '2026-11-03', note: '' });
let b = balances(S);
assert.equal(b.get(cash.id), -1250 + 5000);
assert.equal(b.get(bank.id), 100000 + 200000 - 5000);
assert.deepEqual(monthTotals(S, '2026-11'), { income: 200000, expense: 1250, net: 198750 }); // las transferencias no cuentan
assert.equal(netWorthSeries(S, '2026-11', 2)[0].value, 100000);
assert.equal(netWorthSeries(S, '2026-11', 2)[1].value, 298750);

// Recurrentes
S.recurring.push({ id: 'r', type: 'expense', amount: 50000, accountId: bank.id, categoryId: cat, note: 'Alquiler', freq: 'monthly', interval: 1, nextDate: '2026-08-31', anchorDay: 31, active: true });
assert.equal(runRecurring(S, '2026-11-12'), 3); // 31 ago, 30 sep, 31 oct
assert.equal(S.recurring[0].nextDate, '2026-11-30');
assert.equal(runRecurring(S, '2026-11-12'), 0); // no duplica

// CSV: exportar e importar de vuelta da los mismos saldos
const csv = toCSV(S);
assert.ok(csv.includes("'=SUMA(A1)")); // fórmula neutralizada
const rows = parseCSV(csv);
assert.ok(isOwnCSV(rows[0]));
assert.deepEqual(importOwnCSV(S, rows), { added: 0, skipped: 6, errors: 0 });
const S2 = newState();
S2.accounts[1].initial = 100000;
assert.deepEqual(importOwnCSV(S2, rows), { added: 6, skipped: 0, errors: 0 });
const b1 = balances(S), b2 = balances(S2);
assert.equal(b2.get(S2.accounts[0].id), b1.get(cash.id));
assert.equal(b2.get(S2.accounts[1].id), b1.get(bank.id));
assert.equal(S2.tx.find((t) => t.note.includes('pan')).note, 'pan; "integral"');

// CSV de banco
const bankRows = parseCSV('Fecha,Concepto,Importe\n03/11/2026,"MERCADONA, S.A.","-45,30"\n04/11/2026,Nomina,"1.200,00"\nmal,fila,x\n');
const S3 = newState();
const res = importGenericCSV(S3, bankRows, { dateCol: 0, amountCol: 2, descCol: 1, catCol: -1, accountId: S3.accounts[0].id });
assert.deepEqual(res, { added: 2, skipped: 0, errors: 1 });
assert.equal(balances(S3).get(S3.accounts[0].id), 120000 - 4530);

console.log('Todas las pruebas han pasado ✔');

// ---------- Versión 1.5: divisiones, etiquetas, comisiones, saldo acumulado, papelera ----------
import { txParts, byCategory, spentInCategory, runningBalances, byTag, parseTags, allTags, purgeTrash, FEE_CATEGORY } from '../js/model.js';
{
  const T = newState();
  const [c1, c2] = T.accounts; c1.initial = 10000; c2.initial = 0;
  const [food, rest] = T.categories;
  // gasto de 80 dividido en 60 + 20
  T.tx.push({ id: 'a', ts: 1, type: 'expense', amount: 8000, accountId: c1.id, categoryId: null, splits: [{ categoryId: food.id, amount: 6000 }, { categoryId: rest.id, amount: 2000 }], date: '2026-11-01', note: 'compra', tags: ['Viaje', 'coche'] });
  // transferencia de 10 con 1 de comisión
  T.tx.push({ id: 'b', ts: 2, type: 'transfer', amount: 1000, fee: 100, accountId: c1.id, toAccountId: c2.id, date: '2026-11-02', note: '' });
  T.tx.push({ id: 'c', ts: 3, type: 'expense', amount: 500, accountId: c2.id, categoryId: food.id, date: '2026-11-03', note: '', tags: ['viaje'] });
  const bb = balances(T);
  assert.equal(bb.get(c1.id), 10000 - 8000 - 1000 - 100);
  assert.equal(bb.get(c2.id), 1000 - 500);
  assert.deepEqual(monthTotals(T, '2026-11'), { income: 0, expense: 8000 + 100 + 500, net: -8600 });
  assert.equal(spentInCategory(T, '2026-11', food.id), 6500);
  assert.equal(spentInCategory(T, '2026-11', rest.id), 2000);
  const cats = byCategory(T, '2026-11', 'expense');
  assert.equal(cats.reduce((s, c) => s + c.total, 0), 8600); // las categorías suman lo mismo que el total
  assert.equal(cats.find((c) => c.cat === FEE_CATEGORY).total, 100);
  assert.equal(txParts(T.tx[2]).length, 1);
  // saldo acumulado
  const r1 = runningBalances(T, c1.id);
  assert.deepEqual([r1.get('a'), r1.get('b'), r1.get('c')], [2000, 900, 900]);
  const rAll = runningBalances(T);
  assert.deepEqual([rAll.get('a'), rAll.get('b'), rAll.get('c')], [2000, 1900, 1400]);
  assert.equal(rAll.get('c'), bb.get(c1.id) + bb.get(c2.id)); // el último saldo acumulado = patrimonio
  assert.equal(netWorthSeries(T, '2026-11', 1)[0].value, 1400);
  // etiquetas
  assert.deepEqual(parseTags(' #Viaje, coche ,, viaje;moto'), ['Viaje', 'coche', 'moto']);
  assert.equal(allTags(T).length, 2);
  assert.deepEqual(byTag(T, '2026-11'), [{ tag: 'Viaje', total: 8000 }, { tag: 'coche', total: 8000 }, { tag: 'viaje', total: 500 }]);
  // CSV con divisiones, etiquetas y comisión: exportar e importar conserva los saldos
  const rows2 = parseCSV(toCSV(T));
  assert.equal(rows2.length, 1 + 4); // la división ocupa dos filas
  assert.deepEqual(importOwnCSV(T, rows2), { added: 0, skipped: 4, errors: 0 }); // reimportar no duplica
  const T2 = newState(); T2.accounts[0].initial = 10000;
  importOwnCSV(T2, rows2);
  assert.equal(balances(T2).get(T2.accounts[0].id), bb.get(c1.id));
  assert.equal(balances(T2).get(T2.accounts[1].id), bb.get(c2.id));
  assert.deepEqual(T2.tx.find((t) => t.type === 'transfer').fee, 100);
  assert.deepEqual(T2.tx[0].tags, ['Viaje', 'coche']);
  // un CSV antiguo (7 columnas) se sigue reconociendo
  assert.ok(isOwnCSV(['Fecha', 'Tipo', 'Importe', 'Cuenta', 'Cuenta destino', 'Categoría', 'Nota']));
  // papelera: se vacía sola a los 30 días
  T.trash.push({ tx: { id: 'x' }, deletedAt: Date.now() - 31 * 864e5 }, { tx: { id: 'y' }, deletedAt: Date.now() });
  assert.equal(purgeTrash(T), 1);
  assert.equal(T.trash[0].tx.id, 'y');
  // recurrente de transferencia con comisión
  T.recurring.push({ id: 'r2', type: 'transfer', amount: 1000, fee: 50, accountId: c1.id, toAccountId: c2.id, note: 'Ahorro', freq: 'monthly', interval: 1, nextDate: '2026-11-05', anchorDay: 5, active: true });
  runRecurring(T, '2026-11-06');
  assert.equal(T.tx.at(-1).fee, 50);
  console.log('Pruebas de la versión 1.5 superadas ✔');
}
