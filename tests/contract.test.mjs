/**
 * What a tool result says, and what happens when Tally does not answer with
 * data. A failed request used to parse to an empty row list, so a missing
 * company was indistinguishable from a report with nothing in it.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTally, callTool } from './helpers.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';
import { runWithTallyTarget } from '../dist/tally-target.mjs';

let tally;
let server;

const call = (name, args) => runWithTallyTarget(
    { host: '127.0.0.1', port: tally.port, timeout: 5000 },
    () => callTool(server, name, args));

/** What Tally answers when the company named is not loaded. */
const NO_COMPANY = '<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DESC></DESC></BODY></ENVELOPE>';

before(async () => {
    tally = await startFakeTally(0);
    server = await registerMcpServer();
});

beforeEach(() => {
    tally.requests.length = 0;
    tally.setResponse(null);
});

after(async () => { await tally.close(); });

test('a refused request is an error, not an empty report', async () => {
    tally.setResponse(NO_COMPANY);

    for (const [tool, args] of [
        ['trial-balance', { fromDate: '2024-04-01', toDate: '2025-03-31' }],
        ['chart-of-accounts', {}],
        ['list-master', { collection: 'ledger' }],
        ['daybook', { fromDate: '2024-04-01', toDate: '2024-04-30' }],
    ]) {
        const { isError, text } = await call(tool, args);
        assert.equal(isError, true, `${tool} reported success for a refused request`);
        assert.match(text, /no company is open/, `${tool} gave no usable reason: ${text}`);
    }
});

test('a line error is reported with the message Tally gave', async () => {
    tally.setResponse('<RESPONSE><LINEERROR>Could not find Company</LINEERROR></RESPONSE>');

    const { isError, text } = await call('list-master', { collection: 'ledger' });
    assert.equal(isError, true);
    assert.equal(text, 'Could not find Company');
});

test('an empty body is reported rather than read as no rows', async () => {
    tally.setResponse('');

    const { isError, text } = await call('list-master', { collection: 'ledger' });
    assert.equal(isError, true);
    assert.match(text, /Empty response received from Tally/);
});

test('a report that matched nothing is a success with no rows', async () => {
    tally.setResponse('<DATA></DATA>');

    const { isError, text } = await call('trial-balance', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.equal(isError, false, 'an empty result is not a failure');

    const payload = JSON.parse(text);
    assert.equal(payload.rowCount, 0);
    assert.equal(payload.tableID, '');
    assert.ok(!('rows' in payload), 'there are no rows to carry');
});

test('the same is true of a report tool', async () => {
    tally.setResponse((body) => body.includes('FldGuid') ? '<DATA></DATA>' : null);

    const { isError, text } = await call('ledger-account',
        { ledgerName: 'Acme Ltd', fromDate: '2024-04-01', toDate: '2025-03-31' });

    assert.equal(isError, false);
    assert.equal(JSON.parse(text).rowCount, 0);
});

test('an import that answers with no counters is an error', async () => {
    tally.setResponse((body) => /Import Data/.test(body) ? NO_COMPANY : null);

    const { isError, text } = await call('ledger-create-update', { masters: [{ name: 'X' }] });
    assert.equal(isError, true);
    assert.match(text, /no company is open/);
});

test('an import that partly failed keeps its counters and its message', async () => {
    tally.setResponse((body) => /Import Data/.test(body)
        ? '<RESPONSE><CREATED>1</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger already exists</LINEERROR></RESPONSE>'
        : null);

    const { isError, text } = await call('ledger-create-update', { masters: [{ name: 'X' }] });
    assert.equal(isError, false);

    const status = JSON.parse(text);
    assert.equal(status.CREATED, 1);
    assert.deepEqual(status.lineErrors, ['Ledger already exists']);
});

test('a result says what it counts, what it is of, and when it was read', async () => {
    const { text } = await call('trial-balance',
        { targetCompany: 'Acme Ltd', fromDate: '2024-04-01', toDate: '2025-03-31' });

    const payload = JSON.parse(text);
    assert.equal(payload.rowCount, 1);
    assert.equal(payload.company, 'Acme Ltd');
    assert.deepEqual(payload.period, { fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.deepEqual(payload.columns,
        ['ledger_name', 'group_name', 'opening_balance', 'net_debit', 'net_credit', 'closing_balance']);
    assert.ok(Date.parse(payload.generatedAt) > 0);
    assert.ok(Date.parse(payload.expiresAt) > Date.parse(payload.generatedAt));
});

test('a small result is carried inline and matches the cached table', async () => {
    const { text } = await call('trial-balance', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    const payload = JSON.parse(text);

    assert.ok(Array.isArray(payload.rows), 'one row should not need a second round trip');
    assert.equal(payload.rows.length, payload.rowCount);

    const viaSql = JSON.parse((await call('query-database',
        { sql: `SELECT ${payload.columns.map((c) => `"${c}"`).join(', ')} FROM ${payload.tableID}` })).text);

    assert.deepEqual(payload.rows, viaSql, 'inline rows and the cached table disagree');
});
