/**
 * Measures how long the result cache takes to store a report, one row at a time
 * against in batches.
 *
 * The benchmark of the live server could say a 2548 row ledger history spent
 * about 750 ms inserting rows, but not what a different insert would cost. This
 * runs both on identical rows held in memory, so the number is about the insert
 * and nothing else. No Tally, no network.
 *
 * Run with `node scripts/bench-cache-insert.mjs`, and `ROWS=131` to try another
 * size. Build first, it reads dist/.
 */
import { PGlite } from '@electric-sql/pglite';
import { ResultCache } from '../dist/database.mjs';

const ROWS = Number(process.env.ROWS || 2548);
const SAMPLES = Number(process.env.SAMPLES || 7);

/** The columns of a ledger statement, which is the workload being measured. */
const COLUMNS = new Map([
    ['guid', 'string'], ['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'],
    ['alternate_ledger', 'string'], ['party_name', 'string'], ['amount', 'amount'], ['narration', 'string'],
]);

const rows = Array.from({ length: ROWS }, (_, i) => ({
    guid: `e01d9d1a-0000-0000-0000-${String(i).padStart(12, '0')}`,
    date: new Date(2024, 3, 1 + (i % 28)),
    voucher_type: 'Payment',
    voucher_number: String(i),
    alternate_ledger: 'A Sundry Creditors Ledger Name',
    party_name: 'A Reasonably Long Party Ledger Name',
    amount: i * 1.25,
    narration: `Being payment made against invoice number ${i}`,
}));

const sqlTypeFor = (type) => ['number', 'amount', 'quantity', 'rate'].includes(type) ? 'NUMERIC(18,4)'
    : type === 'boolean' ? 'BOOLEAN' : type === 'date' ? 'DATE' : 'TEXT';

const toValue = (value, type) => ['number', 'amount', 'quantity', 'rate'].includes(type)
    ? (value === null || value === undefined || value === '' ? null : Number(value))
    : type === 'date' ? (value instanceof Date ? value.toISOString().slice(0, 10) : null)
        : (value || '');

/** What cacheTable used to do: one parameterised INSERT for every row. */
async function rowAtATime() {
    const pg = await PGlite.create('memory://');
    const columns = [...COLUMNS];
    await pg.exec(`CREATE TABLE t (${columns.map(([name, type]) => `"${name}" ${sqlTypeFor(type)}`).join(', ')});`);

    const sql = `INSERT INTO t (${columns.map(([name]) => `"${name}"`).join(', ')})`
        + ` VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`;

    const started = performance.now();
    await pg.transaction(async (tx) => {
        for (const row of rows)
            await tx.query(sql, columns.map(([name, type]) => toValue(row[name], type)));
    });
    const ms = performance.now() - started;

    await pg.close();
    return ms;
}

/** What it does now. */
async function batched() {
    const cache = await ResultCache.create();
    const started = performance.now();
    await cache.cacheTable(COLUMNS, rows);
    const ms = performance.now() - started;
    cache.close();
    return ms;
}

const before = [];
const after = [];

// alternated, so a busy moment on the machine falls on both and not on one
for (let sample = 0; sample < SAMPLES; sample++) {
    before.push(await rowAtATime());
    after.push(await batched());
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const line = (name, values) => `${name.padEnd(14)} median ${median(values).toFixed(1)} ms`
    + `, min ${Math.min(...values).toFixed(1)}, max ${Math.max(...values).toFixed(1)}`;

console.log(`${ROWS} rows, ${COLUMNS.size} columns, ${SAMPLES} samples each, alternated`);
console.log(line('row at a time', before));
console.log(line('batched', after));
console.log(`reduction: ${(100 * (1 - median(after) / median(before))).toFixed(1)}%`);
