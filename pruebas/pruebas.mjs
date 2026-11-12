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
