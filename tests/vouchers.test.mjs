import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTally, callTool } from './helpers.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';
import { runWithTallyTarget } from '../dist/tally-target.mjs';

let tally;
let server;

/**
 * Calls a tool against this file's own fake Tally. The test files run at the
 * same time, so each one binds a port of its own rather than the configured
 * default, and the target is carried in for the duration of the call.
 */
const call = (name, args) => runWithTallyTarget(
    { host: '127.0.0.1', port: tally.port, timeout: 5000 },
    () => callTool(server, name, args));

/** Names a collection query asks for, so one fake can answer several collections. */
const collectionOf = (body) => /<COLLECTION NAME="MyCollection"><TYPE>([A-Za-z]+)<\/TYPE>/.exec(body)?.[1] ?? '';

const namesXml = (...names) => `<DATA>${names.map((n) => `<ROW><NAME>${n}</NAME></ROW>`).join('')}</DATA>`;

const daybookRow = (guid, number, type) => '<ROW>'
    + `<GUID>${guid}</GUID><DATE>2024-05-01</DATE><VOUCHER_TYPE>${type}</VOUCHER_TYPE>`
    + `<VOUCHER_NUMBER>${number}</VOUCHER_NUMBER><REFERENCE>PO-9</REFERENCE><PARTY_LEDGER>Acme Ltd</PARTY_LEDGER>`
    + '<AMOUNT>1000</AMOUNT><NARRATION>note</NARRATION><IS_CANCELLED>0</IS_CANCELLED><IS_OPTIONAL>0</IS_OPTIONAL>'
    + '</ROW>';

/** Answers each request by what it asks for, so the write tools see a believable Tally. */
function fakeTally(body) {
    if (/TALLYREQUEST>Import Data/.test(body))
        return '<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>';

    if (body.includes('FldIsCancelled')) // daybook
        return `<DATA>${daybookRow('g-1', 'V1', 'Payment')}${daybookRow('g-2', 'V2', 'Sales')}</DATA>`;

    if (body.includes('FldIsDeemedPositive')) // voucher ledger entries
        return '<DATA><ROW><GUID>g-1</GUID><LEDGER_NAME>Cash</LEDGER_NAME><AMOUNT>-1000</AMOUNT>'
            + '<IS_DEBIT>1</IS_DEBIT><COST_CENTRE></COST_CENTRE></ROW></DATA>';

    if (body.includes('FldBillName')) // bill allocations
        return '<DATA><ROW><GUID>g-1</GUID><LEDGER_NAME>Acme Ltd</LEDGER_NAME><BILL_NAME>B-1</BILL_NAME>'
            + '<BILL_TYPE>New Ref</BILL_TYPE><AMOUNT>1000</AMOUNT></ROW></DATA>';

    if (body.includes('FldStockItem')) // inventory entries
        return '<DATA><ROW><GUID>g-1</GUID><STOCK_ITEM_NAME>Widget</STOCK_ITEM_NAME><QUANTITY>2</QUANTITY>'
            + '<RATE>500</RATE><AMOUNT>1000</AMOUNT><GODOWN_NAME>Main</GODOWN_NAME><TRACKING_NUMBER></TRACKING_NUMBER></ROW></DATA>';

    const collection = collectionOf(body);
    if (collection === 'Ledger') return namesXml('Cash', 'Acme Ltd', 'Sales A/c');
    if (collection === 'VoucherType') return namesXml('Payment', 'Sales');
    if (collection === 'StockItem') return namesXml('Widget');

    return namesXml('Acme Ltd');
}

before(async () => {
    tally = await startFakeTally(0);
    server = await registerMcpServer();
});

beforeEach(() => {
    tally.requests.length = 0;
    tally.setResponse(fakeTally);
});

after(async () => { await tally.close(); });

test('daybook caches its rows and reports the paging position', async () => {
    const { isError, text } = await call('daybook',
        { fromDate: '2024-05-01', toDate: '2024-05-31', limit: 1 });
    assert.equal(isError, false);

    const payload = JSON.parse(text);
    assert.equal(payload.rowCount, 1);
    assert.equal(payload.totalRowCount, 2);
    assert.equal(payload.hasMore, true);
    assert.equal(payload.nextOffset, 1);

    const rows = JSON.parse((await call('query-database',
        { sql: `SELECT guid, voucher_number, amount, is_cancelled FROM ${payload.tableID}` })).text);
    assert.deepEqual(rows, [{ guid: 'g-1', voucher_number: 'V1', amount: 1000, is_cancelled: false }]);
});

test('the last daybook page reports no continuation', async () => {
    const { text } = await call('daybook',
        { fromDate: '2024-05-01', toDate: '2024-05-31', offset: 1 });
    const payload = JSON.parse(text);
    assert.equal(payload.hasMore, false);
    assert.equal(payload.nextOffset, null);
});

test('daybook excludes cancelled and optional vouchers unless asked', async () => {
    await call('daybook', { fromDate: '2024-05-01', toDate: '2024-05-31' });
    assert.match(tally.lastRequest(), /NOT \$IsCancelled/);
    assert.match(tally.lastRequest(), /NOT \$IsOptional/);

    await call('daybook',
        { fromDate: '2024-05-01', toDate: '2024-05-31', includeCancelled: true, includeOptional: true });
    assert.doesNotMatch(tally.lastRequest(), /NOT \$IsCancelled/);
});

test('a quote in a daybook filter cannot unbalance the TDL', async () => {
    await call('daybook',
        { fromDate: '2024-05-01', toDate: '2024-05-31', voucherType: 'Sa"les', partyLedgerName: 'Ac"me' });

    const filters = tally.lastRequest().match(/<SYSTEM TYPE="Formulae"[^>]*>(.*?)<\/SYSTEM>/g) ?? [];
    assert.ok(filters.length > 0);
    for (const filter of filters) {
        const quotes = filter.match(/&quot;/g) ?? [];
        assert.equal(quotes.length % 2, 0, `unbalanced filter: ${filter}`);
    }
});

test('voucher-get returns the header with every line of the voucher', async () => {
    const { isError, text } = await call('voucher-get',
        { voucherGuid: 'g-1', date: '2024-05-01' });
    assert.equal(isError, false);

    const payload = JSON.parse(text);
    assert.equal(payload.voucher.guid, 'g-1');
    assert.equal(payload.voucher.party_name, 'Acme Ltd', 'party_ledger should be renamed to party_name');
    assert.equal(payload.ledger_entries.length, 1);
    assert.equal(payload.ledger_entries[0].ledger_name, 'Cash');
    assert.equal(payload.ledger_entries[0].amount, -1000);
    assert.equal(payload.bill_allocations[0].bill_name, 'B-1');
    assert.equal(payload.inventory_entries[0].stock_item_name, 'Widget');
});

test('voucher-get skips the lookups it is told to skip', async () => {
    const { text } = await call('voucher-get',
        { voucherGuid: 'g-1', date: '2024-05-01', includeBills: false, includeInventory: false });

    const payload = JSON.parse(text);
    assert.ok(!('bill_allocations' in payload));
    assert.ok(!('inventory_entries' in payload));
    assert.equal(tally.requests.length, 2, 'only the header and the ledger lines should be fetched');
});

test('voucher-get reports a guid that is not on that date', async () => {
    const { isError, text } = await call('voucher-get',
        { voucherGuid: 'nope', date: '2024-05-01' });
    assert.equal(isError, true);
    assert.match(text, /No voucher found with guid nope/);
});

test('an unbalanced voucher is refused and nothing reaches Tally', async () => {
    const { isError, text } = await call('voucher-create-update', {
        vouchers: [{
            voucherType: 'Payment', date: '2024-05-01',
            entries: [{ ledgerName: 'Cash', amount: -1000 }, { ledgerName: 'Acme Ltd', amount: 900 }],
        }],
    });

    assert.equal(isError, true);
    assert.match(text, /do not balance, debits and credits differ by 100/);
    assert.ok(!tally.requests.some((body) => /Import Data/.test(body)), 'an invalid voucher must not be sent');
});

test('an unknown ledger and an unknown voucher type are both reported at once', async () => {
    const { isError, text } = await call('voucher-create-update', {
        vouchers: [{
            voucherType: 'Nonsense', date: '2024-05-01',
            entries: [{ ledgerName: 'Ghost', amount: -100 }, { ledgerName: 'Cash', amount: 100 }],
        }],
    });

    assert.equal(isError, true);
    assert.match(text, /no voucher type named Nonsense/);
    assert.match(text, /no ledger named Ghost/);
});

test('bill references that do not add up to their line are refused', async () => {
    const { isError, text } = await call('voucher-create-update', {
        vouchers: [{
            voucherType: 'Payment', date: '2024-05-01',
            entries: [
                { ledgerName: 'Acme Ltd', amount: -1000, billAllocations: [{ name: 'B-1', billType: 'Agst Ref', amount: -600 }] },
                { ledgerName: 'Cash', amount: 1000 },
            ],
        }],
    });

    assert.equal(isError, true);
    assert.match(text, /bill references on Acme Ltd add up to -600/);
});

test('a debit line is sent as a deemed positive negative amount', async () => {
    const { isError } = await call('voucher-create-update', {
        verify: false,
        vouchers: [{
            voucherType: 'Payment', date: '2024-05-01', voucherNumber: 'V1', narration: 'rent',
            entries: [{ ledgerName: 'Acme Ltd', amount: -1000 }, { ledgerName: 'Cash', amount: 1000 }],
        }],
    });
    assert.equal(isError, false);

    const sent = tally.requests.find((body) => /Import Data/.test(body));
    assert.ok(sent, 'the voucher was never sent');
    assert.match(sent, /<REPORTNAME>Vouchers<\/REPORTNAME>/);
    assert.match(sent, /<DATE>20240501<\/DATE>/);
    assert.match(sent, /ACTION="Create"/);
    assert.match(sent, /<LEDGERNAME>Acme Ltd<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-1000<\/AMOUNT>/);
    assert.match(sent, /<LEDGERNAME>Cash<\/LEDGERNAME><ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE><AMOUNT>1000<\/AMOUNT>/);
});

test('an alter carries the guid and needs one', async () => {
    const missing = await call('voucher-create-update', {
        vouchers: [{
            action: 'alter', voucherType: 'Payment', date: '2024-05-01',
            entries: [{ ledgerName: 'Cash', amount: -1 }, { ledgerName: 'Acme Ltd', amount: 1 }],
        }],
    });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /guid is required to alter/);

    await call('voucher-create-update', {
        verify: false,
        vouchers: [{
            action: 'alter', guid: 'g-1', voucherType: 'Payment', date: '2024-05-01',
            entries: [{ ledgerName: 'Cash', amount: -1 }, { ledgerName: 'Acme Ltd', amount: 1 }],
        }],
    });

    const sent = tally.requests.find((body) => /Import Data/.test(body));
    assert.match(sent, /ACTION="Alter"/);
    assert.match(sent, /REMOTEID="g-1"/);
});

test('an invoice balances the accounting side held inside its inventory lines', async () => {
    const { isError } = await call('voucher-create-update', {
        verify: false,
        vouchers: [{
            voucherType: 'Sales', date: '2024-05-01', isInvoice: true, partyLedgerName: 'Acme Ltd',
            entries: [{ ledgerName: 'Acme Ltd', amount: -1000 }],
            inventoryEntries: [{ stockItemName: 'Widget', quantity: 2, rate: 500, amount: 1000, ledgerName: 'Sales A/c' }],
        }],
    });
    assert.equal(isError, false);

    const sent = tally.requests.find((body) => /Import Data/.test(body));
    assert.match(sent, /OBJVIEW="Invoice Voucher View"/);
    assert.match(sent, /<STOCKITEMNAME>Widget<\/STOCKITEMNAME>/);
    assert.match(sent, /<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales A\/c<\/LEDGERNAME>/);
});

test('the readback reports the vouchers Tally kept', async () => {
    const { text } = await call('voucher-create-update', {
        vouchers: [{
            voucherType: 'Payment', date: '2024-05-01', voucherNumber: 'V1',
            entries: [{ ledgerName: 'Cash', amount: -1 }, { ledgerName: 'Acme Ltd', amount: 1 }],
        }],
    });

    const payload = JSON.parse(text);
    assert.equal(payload.CREATED, 1);
    assert.equal(payload.verified.length, 1);
    assert.equal(payload.verified[0].guid, 'g-1');
});

test('an unknown guid is never cancelled or deleted', async () => {
    const { isError, text } = await call('voucher-cancel-delete',
        { mode: 'delete', vouchers: [{ guid: 'ghost', date: '2024-05-01' }] });

    assert.equal(isError, true);
    assert.match(text, /No voucher found for: ghost on 2024-05-01/);
    assert.ok(!tally.requests.some((body) => /Import Data/.test(body)));
});

test('a known guid is deleted with its own voucher type', async () => {
    const { isError } = await call('voucher-cancel-delete',
        { mode: 'delete', vouchers: [{ guid: 'g-2', date: '2024-05-01' }] });
    assert.equal(isError, false);

    const sent = tally.requests.find((body) => /Import Data/.test(body));
    assert.match(sent, /ACTION="Delete"/);
    assert.match(sent, /VCHTYPE="Sales"/);
    assert.ok(!/ALLLEDGERENTRIES/.test(sent), 'a delete carries no entries');
});

test('delete-master sends a voucher to the tool that can identify one', async () => {
    const { isError, text } = await call('delete-master',
        { collection: 'Voucher', name: ['V1'] });
    assert.equal(isError, true);
    assert.match(text, /voucher-cancel-delete/);
});
