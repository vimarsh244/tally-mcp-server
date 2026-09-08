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

const ledgerRow = (name, parent, closing) => '<ROW>'
    + `<NAME>${name}</NAME><PARENT>${parent}</PARENT><CLOSINGBALANCE>${closing}</CLOSINGBALANCE>`
    + '<OPENINGBALANCE>0</OPENINGBALANCE><DEBITTOTALS>0</DEBITTOTALS><CREDITTOTALS>0</CREDITTOTALS>'
    + '<BOOKSFROM>2024-04-01</BOOKSFROM><ISACTIVECOMPANY>Yes</ISACTIVECOMPANY></ROW>';

/** A balance sheet ledger set that includes the Profit & Loss ledger. */
const balanceSheetLedgers = (body) => body.includes('<TYPE>Ledger</TYPE>')
    ? `<DATA>${ledgerRow('Cash', 'Cash-in-Hand', -500)}${ledgerRow('Profit &amp; Loss A/c', 'Reserves &amp; Surplus', 500)}</DATA>`
    : '<DATA></DATA>';

before(async () => {
    tally = await startFakeTally(0);
    server = await registerMcpServer();
});

beforeEach(() => {
    tally.requests.length = 0;
    tally.setResponse(null);
});

after(async () => { await tally.close(); });

test('the balance sheet reports Profit & Loss A/c once', async () => {
    tally.setResponse(balanceSheetLedgers);

    const { text } = await call('balance-sheet', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    const payload = JSON.parse(text);

    const profitAndLoss = payload.rows.filter((row) => row.ledger_name === 'Profit & Loss A/c');
    assert.equal(profitAndLoss.length, 1, 'the line used to be added a second time');
    assert.equal(profitAndLoss[0].group_name, '', 'it is presented on its own, so it carries no group');
});

test('the balance sheet no longer spends a query on a row it already has', async () => {
    tally.setResponse(balanceSheetLedgers);

    await call('balance-sheet', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.equal(tally.requests.length, 2, 'the ledgers and the stock group, and nothing more');
});

test('a statement says whether it balances', async () => {
    tally.setResponse(balanceSheetLedgers);

    const { text } = await call('balance-sheet', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.equal(JSON.parse(text).checks.closingBalanceTotal, 0);
});

test('an out of balance statement says so rather than looking fine', async () => {
    tally.setResponse((body) => body.includes('<TYPE>Ledger</TYPE>')
        ? `<DATA>${ledgerRow('Cash', 'Cash-in-Hand', -500)}${ledgerRow('Capital', 'Capital Account', 400)}</DATA>`
        : '<DATA></DATA>');

    const { text } = await call('balance-sheet', { fromDate: '2024-04-01', toDate: '2025-03-31' });
    assert.equal(JSON.parse(text).checks.closingBalanceTotal, -100);
});

test('the company list is read fresh when no company was named', async () => {
    // which company is active can change at any moment, including from another
    // session, so it is never answered from what this process remembers
    for (let attempt = 0; attempt < 2; attempt++) {
        tally.requests.length = 0;
        await call('ledger-create-update', { masters: [{ name: 'X' }] });
        const companyQueries = tally.requests.filter((body) => body.includes('<TYPE>Company</TYPE>'));
        assert.equal(companyQueries.length, 1, 'the active company must be looked up every time');
    }
});

test('the company list is remembered when the caller named one', async () => {
    await call('ledger-create-update', { targetCompany: 'Acme Ltd', masters: [{ name: 'X' }] });

    tally.requests.length = 0;
    await call('ledger-create-update', { targetCompany: 'Acme Ltd', masters: [{ name: 'Y' }] });

    const companyQueries = tally.requests.filter((body) => body.includes('<TYPE>Company</TYPE>'));
    assert.equal(companyQueries.length, 0, 'the books begin date does not change, so it is not fetched again');
});

test('changing the active company drops what was remembered', async () => {
    await call('ledger-create-update', { targetCompany: 'Acme Ltd', masters: [{ name: 'X' }] });
    await call('set-company', { companyName: 'Other Ltd' });

    tally.requests.length = 0;
    await call('ledger-create-update', { targetCompany: 'Acme Ltd', masters: [{ name: 'Y' }] });

    const companyQueries = tally.requests.filter((body) => body.includes('<TYPE>Company</TYPE>'));
    assert.equal(companyQueries.length, 1);
});
