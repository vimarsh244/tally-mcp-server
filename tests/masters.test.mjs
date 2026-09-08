import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTally, callTool } from './helpers.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';
import { runWithTallyTarget } from '../dist/tally-target.mjs';

let tally;
let server;

/** Each test file binds its own port, because the files run at the same time. */
const call = (name, args) => runWithTallyTarget(
    { host: '127.0.0.1', port: tally.port, timeout: 5000 },
    () => callTool(server, name, args));

/** The import request the tool sent, or undefined when it sent none. */
const sentImport = () => tally.requests.find((body) => /TALLYREQUEST>Import Data/.test(body));

before(async () => {
    tally = await startFakeTally(0);
    server = await registerMcpServer();
});

beforeEach(() => { tally.requests.length = 0; });

after(async () => { await tally.close(); });

test('a bank ledger carries its account number, IFSC and branch', async () => {
    const { isError } = await call('ledger-create-update', {
        masters: [{
            name: 'HDFC Bank', parent: 'Bank Accounts',
            bankDetails: {
                accountHolderName: 'Acme Ltd', accountNumber: '50100123456789',
                ifscCode: 'HDFC0000123', bankName: 'HDFC Bank', branchName: 'Vasna',
            },
        }],
    });
    assert.equal(isError, false);

    const sent = sentImport();
    assert.match(sent, /<BANKDETAILS>50100123456789<\/BANKDETAILS>/);
    assert.match(sent, /<IFSCODE>HDFC0000123<\/IFSCODE>/);
    assert.match(sent, /<BANKACCHOLDERNAME>Acme Ltd<\/BANKACCHOLDERNAME>/);
    assert.match(sent, /<BRANCHNAME>Vasna<\/BRANCHNAME>/);
});

test('contact details reach Tally', async () => {
    await call('ledger-create-update', {
        masters: [{
            name: 'Acme Ltd',
            contactDetails: { contactPerson: 'R Shah', phone: '079-123', mobile: '9876543210', email: 'a@b.com' },
        }],
    });

    const sent = sentImport();
    assert.match(sent, /<LEDGERCONTACT>R Shah<\/LEDGERCONTACT>/);
    assert.match(sent, /<LEDGERMOBILE>9876543210<\/LEDGERMOBILE>/);
    assert.match(sent, /<EMAIL>a@b.com<\/EMAIL>/);
});

test('GST details are sent without mailing details', async () => {
    // they used to be nested inside the mailing block, so a ledger with only a
    // GSTIN silently lost it
    await call('ledger-create-update', {
        masters: [{ name: 'Acme Ltd', gstRegistrationDetails: { gstin: '27AAPFU0939F1ZV', registrationType: 'Regular' } }],
    });

    assert.match(sentImport(), /<GSTIN>27AAPFU0939F1ZV<\/GSTIN>/);
});

test('a blank pincode is accepted, because that is how it is reset', async () => {
    const shape = server._registeredTools['ledger-create-update'].inputSchema.shape;
    const pincode = shape.masters.element.shape.mailingDetails.unwrap().shape.pincode;

    assert.equal(pincode.safeParse('').success, true, 'a blank pincode must clear the field');
    assert.equal(pincode.safeParse('380001').success, true);
    assert.equal(pincode.safeParse('12345').success, false);
});

test('an address becomes one ADDRESS line per line of text', async () => {
    await call('ledger-create-update', {
        masters: [{
            name: 'Acme Ltd',
            mailingDetails: { country: 'India', state: 'Gujarat', address: ['12 Main Road', 'Vasna'] },
        }],
    });

    const sent = sentImport();
    assert.match(sent, /<ADDRESS>12 Main Road<\/ADDRESS><ADDRESS>Vasna<\/ADDRESS>/);
});

test('a simple unit and a compound unit are told apart', async () => {
    const incomplete = await call('unit-create-update', { masters: [{ name: 'Box', baseUnit: 'Nos' }] });
    assert.equal(incomplete.isError, true);
    assert.match(incomplete.text, /needs baseUnit, additionalUnit and conversion together/);
    assert.equal(sentImport(), undefined, 'an incomplete unit must not be sent');

    await call('unit-create-update', { masters: [{ name: 'Nos', formalName: 'Numbers' }] });
    assert.match(sentImport(), /<ISSIMPLEUNIT>Yes<\/ISSIMPLEUNIT>/);
    assert.match(sentImport(), /<FORMALNAME>Numbers<\/FORMALNAME>/);
});

test('a stock item splits its GST rate between CGST and SGST', async () => {
    await call('stock-item-create-update', {
        masters: [{ name: 'Widget', parent: 'Primary', unit: 'Nos', gstDetails: { hsnCode: '8471', rate: 18 } }],
    });

    const sent = sentImport();
    assert.match(sent, /<HSNCODE>8471<\/HSNCODE>/);
    assert.match(sent, /<GSTRATEDUTYHEAD>CGST<\/GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value<\/GSTRATEVALUATIONTYPE><GSTRATE>9<\/GSTRATE>/);
    assert.match(sent, /<GSTRATEDUTYHEAD>IGST<\/GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value<\/GSTRATEVALUATIONTYPE><GSTRATE>18<\/GSTRATE>/);
});

test('an alternate unit without a conversion is refused', async () => {
    const { isError, text } = await call('stock-item-create-update', {
        masters: [{ name: 'Widget', unit: 'Nos', alternateUnit: 'Box' }],
    });

    assert.equal(isError, true);
    assert.match(text, /needs a conversion/);
    assert.equal(sentImport(), undefined);
});

test('an opening quantity carries its unit and rate', async () => {
    await call('stock-item-create-update', {
        masters: [{ name: 'Widget', unit: 'Nos', openingQuantity: 10, openingRate: 50, openingValue: 500 }],
    });

    const sent = sentImport();
    assert.match(sent, /<OPENINGBALANCE>10 Nos<\/OPENINGBALANCE>/);
    assert.match(sent, /<OPENINGRATE>50\/Nos<\/OPENINGRATE>/);
    assert.match(sent, /<OPENINGVALUE>500<\/OPENINGVALUE>/);
});

test('each master tool writes its own root tag', async () => {
    for (const [tool, args, tag] of [
        ['group-create-update', { masters: [{ name: 'Loans', parent: 'Liabilities' }] }, 'GROUP'],
        ['stock-group-create-update', { masters: [{ name: 'Raw Material' }] }, 'STOCKGROUP'],
        ['godown-create-update', { masters: [{ name: 'Main Store', address: 'Vasna' }] }, 'GODOWN'],
    ]) {
        tally.requests.length = 0;
        const { isError } = await call(tool, args);
        assert.equal(isError, false, `${tool} failed`);
        assert.match(sentImport(), new RegExp(`<${tag} NAME="`), `${tool} wrote the wrong tag`);
    }
});

test('a godown address is written as address lines', async () => {
    await call('godown-create-update', { masters: [{ name: 'Main Store', address: 'Vasna' }] });
    assert.match(sentImport(), /<ADDRESS.LIST><ADDRESS>Vasna<\/ADDRESS><\/ADDRESS.LIST>/);
});

test('a company that already exists is not created again', async () => {
    const { isError, text } = await call('company-create', {
        name: 'Acme Ltd', booksFrom: '2024-04-01', country: 'India', state: 'Gujarat',
    });

    assert.equal(isError, true);
    assert.match(text, /already exists/);
    assert.equal(sentImport(), undefined);
});

test('a new company carries its books begin date', async () => {
    const { isError } = await call('company-create', {
        name: 'New Ltd', booksFrom: '2024-04-01', country: 'India', state: 'Gujarat', pincode: '380001',
    });
    assert.equal(isError, false);

    const sent = sentImport();
    assert.match(sent, /<COMPANY NAME="New Ltd" ACTION="Create">/);
    assert.match(sent, /<BOOKSFROM>20240401<\/BOOKSFROM>/);
    assert.match(sent, /<STARTINGFROM>20240401<\/STARTINGFROM>/);
    assert.match(sent, /<STATENAME>Gujarat<\/STATENAME>/);
});
