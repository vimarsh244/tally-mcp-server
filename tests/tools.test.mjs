import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { startFakeTally, callTool } from './helpers.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';

const run = promisify(execFile);

let tally;
let server;

before(async () => {
    tally = await startFakeTally(9000);
    server = await registerMcpServer();
});

after(async () => { await tally.close(); });

test('every tool is registered and the manifest matches', () => {
    const registered = Object.keys(server._registeredTools).sort();
    assert.equal(registered.length, 20);

    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.tools.map((t) => t.name).sort(), registered,
        'manifest.json is stale, run `pnpm build:manifest`');
});

test('tools that change Tally state are not marked read only', () => {
    for (const name of ['set-company', 'set-period', 'ledger-create-update', 'delete-master'])
        assert.equal(server._registeredTools[name].annotations.readOnlyHint, false, `${name} claims to be read only`);

    for (const name of ['trial-balance', 'balance-sheet', 'ledger-account', 'query-database'])
        assert.equal(server._registeredTools[name].annotations.readOnlyHint, true, `${name} should be read only`);
});

test('ledger-account exposes party_name and it carries the value', async () => {
    const { isError, text } = await callTool(server, 'ledger-account',
        { ledgerName: 'Acme Ltd', fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.equal(isError, false);

    const { tableID } = JSON.parse(text);
    const rows = JSON.parse((await callTool(server, 'query-database',
        { sql: `SELECT party_name FROM ${tableID} WHERE party_name <> ''` })).text);

    assert.ok(rows.length > 0, 'party_name column is empty, the report field is party_ledger');
    assert.equal(rows[0].party_name, 'Acme Ltd');
});

test('stock-item-account exposes party_name too', async () => {
    const { text } = await callTool(server, 'stock-item-account',
        { itemName: 'Acme Ltd', fromDate: '2024-04-01', toDate: '2025-03-31' });
    const { tableID } = JSON.parse(text);
    const rows = JSON.parse((await callTool(server, 'query-database', { sql: `SELECT * FROM ${tableID} LIMIT 1` })).text);
    assert.ok('party_name' in rows[0]);
});

test('a number field is cached as a number, not as text', async () => {
    // Group.SortPosition is declared 'number'. It used to fall through to the
    // string branch and land in a TEXT column, so ordering was lexical.
    const { text } = await callTool(server, 'query-collection',
        { collection: 'Group', fields: ['Name', 'SortPosition'] });
    const { tableID } = JSON.parse(text);

    const rows = JSON.parse((await callTool(server, 'query-database',
        { sql: `SELECT "SortPosition" FROM ${tableID}` })).text);

    assert.equal(typeof rows[0].SortPosition, 'number',
        'SortPosition came back as text, so SUM and ORDER BY would be wrong');
});

test('a quote in a name cannot unbalance the TDL filter', async () => {
    for (const [tool, args] of [
        ['list-master', { collection: 'ledger', containsFilter: 'ac"me' }],
        ['trial-balance', { fromDate: '2024-04-01', toDate: '2025-03-31', group_name: 'Sun"dry' }],
        ['stock-summary', { fromDate: '2024-04-01', toDate: '2025-03-31', stockGroup: 'Raw"Mat' }],
        ['ledger-balance', { ledgerName: 'Ac"me', toDate: '2025-03-31' }],
    ]) {
        await callTool(server, tool, args);
        const filter = /<SYSTEM TYPE="Formulae"[^>]*>(.*?)<\/SYSTEM>/.exec(tally.lastRequest());
        assert.ok(filter, `${tool} sent no filter`);
        // &quot; is the only quote form that may appear, and always in pairs
        const quotes = filter[1].match(/&quot;/g) ?? [];
        assert.equal(quotes.length % 2, 0, `${tool} produced an unbalanced filter: ${filter[1]}`);
        assert.ok(!filter[1].includes('&quot;&quot;'), `${tool} left a doubled quote: ${filter[1]}`);
    }
});

test('a Tally exception is reported, not swallowed', async () => {
    // the ledger existence check must still succeed, only the report may fail
    tally.setResponse((body) => body.includes('FldGuid') ? '<EXCEPTION>Ledger does not exist</EXCEPTION>' : null);
    const { isError, text } = await callTool(server, 'ledger-account',
        { ledgerName: 'Acme Ltd', fromDate: '2024-04-01', toDate: '2025-03-31' });
    tally.setResponse(null);

    assert.equal(isError, true);
    assert.equal(text, 'Ledger does not exist');
});

test('an unreachable Tally produces guidance, not an empty object', async () => {
    // run in a child process so TALLY_PORT points at a port nothing is listening on
    const script = `
        const { registerMcpServer } = await import('./dist/mcp.mjs');
        const s = await registerMcpServer();
        const r = await s._registeredTools['list-master'].handler({ collection: 'ledger' }, {});
        console.log(JSON.stringify({ isError: r.isError === true, text: r.content[0].text }));
    `;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, TALLY_PORT: '9099' },
    });
    const { isError, text } = JSON.parse(stdout.trim());

    assert.equal(isError, true);
    assert.notEqual(text, '{}', 'JSON.stringify on an Error yields {}');
    assert.match(text, /Unable to connect to Tally/);
});

test('an unknown company is reported rather than throwing', async () => {
    const { isError, text } = await callTool(server, 'ledger-create-update',
        { targetCompany: 'Nope Ltd', masters: [{ name: 'X' }] });
    assert.equal(isError, true);
    assert.match(text, /No company found with the name Nope Ltd/);
});

test('BLOCK_WRITE hides the write tools', async () => {
    const script = `
        const { registerMcpServer } = await import('./dist/mcp.mjs');
        const s = await registerMcpServer();
        console.log(Object.keys(s._registeredTools).length);
    `;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, BLOCK_WRITE: '1' },
    });
    assert.equal(stdout.trim(), '18', 'the two write tools should be hidden');
});
