/**
 * The measurable parts of the reporting path: how rows reach the cache, how
 * many requests reach one Tally at a time, and what a trace records.
 */
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startFakeTally, callTool } from './helpers.mjs';
import { ResultCache } from '../dist/database.mjs';
import { postTallyXml } from '../dist/tally/index.mjs';
import { runWithTallyTarget } from '../dist/tally-target.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { config } from '../dist/config.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

let tally;

before(async () => { tally = await startFakeTally(0); });
after(async () => { await tally.close(); });

const columnsOf = (count) => new Map(
    Array.from({ length: count }, (_, i) => [`c${i}`, i === 0 ? 'string' : 'number']));

const rowsOf = (count, columns) => Array.from({ length: count }, (_, r) => {
    const row = {};
    let i = 0;
    for (const [name] of columns) row[name] = i++ === 0 ? `row ${r}` : r;
    return row;
});

test('a batched insert stores exactly what a row at a time stored', async () => {
    const columns = columnsOf(4);
    const rows = rowsOf(1200, columns);
    // a quote, a newline and a character outside ASCII must all survive batching
    rows[0].c0 = 'a "quoted", multi\nline नाम';

    const cache = await ResultCache.create();
    const id = await cache.cacheTable(columns, rows);

    const stored = JSON.parse(await cache.executeSQL(`SELECT c0, c1 FROM ${id} ORDER BY c1`));
    assert.equal(stored.length, 1200);
    assert.equal(stored[0].c0, 'a "quoted", multi\nline नाम');
    assert.equal(stored[1199].c1, 1199);
    cache.close();
});

test('a batch is bounded by the parameter limit, not only by the row count', async () => {
    // 200 columns at 500 rows would need 100000 bind parameters, well over the
    // 32767 the protocol counts, and PGlite answers a statement over that limit
    // with an empty result rather than an error. The batch has to get smaller
    const columns = columnsOf(200);
    const cache = await ResultCache.create();
    const id = await cache.cacheTable(columns, rowsOf(400, columns));

    const stored = JSON.parse(await cache.executeSQL(`SELECT c1 FROM ${id}`));
    assert.equal(stored.length, 400);
    cache.close();
});

test('a failed insert leaves no table behind', async () => {
    const cache = await ResultCache.create();
    const columns = new Map([['name', 'string'], ['amount', 'amount']]);

    // the column holds NUMERIC(18,4), and the value in the third batch does not
    // fit, so the whole insert has to fail
    const rows = rowsOf(1200, columns);
    rows[1100].amount = 1e20;

    await assert.rejects(() => cache.cacheTable(columns, rows), 'the overflow should have failed the insert');

    const tables = JSON.parse(await cache.executeSQL(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 't\\_%'"));
    assert.equal(Number(tables[0].n), 0, 'a half filled table survived the failure');

    // the cache still works afterwards
    assert.equal(typeof (await cache.cacheTable(columns, [{ name: 'x', amount: 1 }])), 'string');
    cache.close();
});

test('no more than the configured number of requests reach one Tally at a time', async () => {
    tally.setDelay(30);
    const target = { host: '127.0.0.1', port: tally.port, timeout: 5000 };

    const results = await runWithTallyTarget(target, () =>
        Promise.all(Array.from({ length: 12 }, () => postTallyXml('<ENVELOPE></ENVELOPE>'))));

    tally.setDelay(0);
    assert.equal(results.length, 12, 'every queued request must still be answered');
    assert.ok(tally.maxInFlight() <= config.tallyMaxConcurrent,
        `${tally.maxInFlight()} requests overlapped, the limit is ${config.tallyMaxConcurrent}`);
    assert.ok(tally.maxInFlight() > 1, 'the requests should still overlap up to the limit');
});

test('the cache is released when the session ends', async () => {
    const server = await registerMcpServer();
    const { text } = await runWithTallyTarget({ host: '127.0.0.1', port: tally.port, timeout: 5000 },
        () => callTool(server, 'query-collection', { collection: 'Group', fields: ['Name'] }));

    const { tableID } = JSON.parse(text);
    await server.close();

    await assert.rejects(() => callTool(server, 'query-database', { sql: `SELECT * FROM ${tableID}` })
        .then((r) => { if (r.isError) throw new Error(r.text); }),
        'the database should be gone with the session');
});

test('registering a session starts no database', async () => {
    // starting PGlite takes about 1.7 seconds, and it used to happen while the
    // session was being registered, which is what a client waits on
    const started = performance.now();
    const server = await registerMcpServer();
    const ms = performance.now() - started;

    assert.ok(ms < 500, `registering took ${ms.toFixed(0)} ms, the database is being started too early`);

    const { isError, text } = await callTool(server, 'query-database', { sql: 'SELECT 1' });
    assert.equal(isError, true);
    assert.match(text, /No result has been cached in this session yet/);

    await server.close();
});

test('the database goes when the transport closes', async () => {
    const server = await registerMcpServer();
    const [, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);

    const { text } = await runWithTallyTarget({ host: '127.0.0.1', port: tally.port, timeout: 5000 },
        () => callTool(server, 'query-collection', { collection: 'Group', fields: ['Name'] }));
    const { tableID } = JSON.parse(text);

    await serverSide.close();

    const after = await callTool(server, 'query-database', { sql: `SELECT * FROM ${tableID}` });
    assert.equal(after.isError, true, 'the session ended, so its tables should be gone');
});

test('a trace explains where the time of a tool call went', async () => {
    const script = `
        const { registerMcpServer } = await import('./dist/mcp.mjs');
        const { runWithTallyTarget } = await import('./dist/tally-target.mjs');
        const s = await registerMcpServer();
        await runWithTallyTarget({ host: '127.0.0.1', port: ${tally.port}, timeout: 5000 },
            () => s._registeredTools['list-master'].handler({ collection: 'ledger' }, {}));
    `;
    const { stderr } = await run(process.execPath, ['--input-type=module', '-e', script],
        { cwd: root, env: { ...process.env, TRACE: '1' } });

    const record = JSON.parse(stderr.trim().split('\n').filter((l) => l.startsWith('{')).pop());

    assert.equal(record.tool, 'list-master');
    assert.equal(record.failed, false);
    assert.ok(record.totalMs >= 0);

    const request = record.spans.find((span) => span.name === 'tally.request');
    assert.ok(request, 'the call to Tally is not timed');
    assert.ok(request.responseBytes > 0);
    assert.ok(request.headersMs <= request.ms, 'the wait for headers is part of the request');
    assert.ok(record.spans.some((span) => span.name === 'tally.queue'), 'the queue wait is not timed');

    // no argument, name or payload may appear in a timing record
    assert.ok(!stderr.includes('ledger'), 'the trace leaked a tool argument');
    assert.ok(!stderr.includes('Acme'), 'the trace leaked data from Tally');
});

test('a trace is silent unless it is switched on', async () => {
    const script = `
        const { registerMcpServer } = await import('./dist/mcp.mjs');
        const { runWithTallyTarget } = await import('./dist/tally-target.mjs');
        const s = await registerMcpServer();
        await runWithTallyTarget({ host: '127.0.0.1', port: ${tally.port}, timeout: 5000 },
            () => s._registeredTools['list-master'].handler({ collection: 'ledger' }, {}));
    `;
    const { stderr } = await run(process.execPath, ['--input-type=module', '-e', script],
        { cwd: root, env: { ...process.env, TRACE: '0' } });

    assert.equal(stderr.trim(), '');
});
