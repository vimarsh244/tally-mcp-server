/**
 * Renders every Tally template with representative data and checks the result
 * is well formed XML. Tally answers a malformed request with an unhelpful
 * message, so a stray tag is worth catching here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLValidator } from 'fast-xml-parser';
import { renderTemplate } from '../dist/templates.mjs';
import { tallyTemplates } from '../dist/templates.generated.mjs';

const date = new Date(2024, 3, 1);

const reportInputs = {
    'report/ledger-account': { fromDate: date, toDate: date, ledgerName: 'Acme Ltd', includeNarration: true },
    'report/stock-item-account': { fromDate: date, toDate: date, itemName: 'Widget' },
    'report/daybook': { fromDate: date, toDate: date, voucherType: 'Sales', partyLedgerName: 'Acme Ltd', includeCancelled: false, includeOptional: false, includeNarration: true },
    'report/voucher-ledger-entries': { fromDate: date, toDate: date, voucherGuid: 'g-1' },
    'report/voucher-bill-allocations': { fromDate: date, toDate: date, voucherGuid: 'g-1' },
    'report/voucher-inventory-entries': { fromDate: date, toDate: date, voucherGuid: 'g-1' },
};

const pushInputs = {
    'push/master-ledger': {
        masters: [{
            name: 'Acme Ltd', parent: 'Sundry Debtors', openingBalance: -100, isBillWise: true, billCreditPeriod: 30,
            contactDetails: { contactPerson: 'R Shah', email: 'a@b.com' },
            bankDetails: { accountNumber: '123', ifscCode: 'HDFC0000123' },
            mailingDetails: { country: 'India', state: 'Gujarat', address: ['12 Main Road'], pincode: '380001', applicableFrom: date },
            gstRegistrationDetails: { gstin: '27AAPFU0939F1ZV', registrationType: 'Regular', applicableFrom: date },
        }],
    },
    'push/master-stock-item': {
        masters: [{
            name: 'Widget', parent: 'Primary', category: '', unit: 'Nos', alternateUnit: 'Box', conversion: 12,
            partNo: 'W-1', costingMethod: 'FIFO', openingQuantity: 10, openingRate: 50, openingValue: 500,
            gstDetails: { hsnCode: '8471', rate: 18, taxability: 'Taxable', applicableFrom: date },
        }],
    },
    'push/master-group': { masters: [{ name: 'Loans', parent: 'Liabilities', isBillWise: false, isCostCentresOn: true }] },
    'push/master-stock-group': { masters: [{ name: 'Raw Material', parent: 'Primary', isAddable: true }] },
    'push/master-godown': { masters: [{ name: 'Main Store', parent: 'Primary', address: ['Vasna'] }] },
    'push/master-unit': { masters: [{ name: 'Nos', formalName: 'Numbers', decimalPlaces: 2 }, { name: 'Box', baseUnit: 'Nos', additionalUnit: 'Box', conversion: 12 }] },
    'push/company': {
        masters: [{
            name: 'New Ltd', booksFrom: date, country: 'India', state: 'Gujarat', mailingName: 'New Ltd',
            address: ['12 Main Road'], pincode: '380001', email: 'a@b.com', phoneNumber: '079-123',
            currencySymbol: 'Rs', currencyName: 'Rupees', isBillWise: true, isInventory: true, isCostCentres: false,
        }],
    },
    'push/voucher': {
        vouchers: [{
            action: 'Create', voucherType: 'Sales', date, effectiveDate: date, voucherNumber: 'V1',
            reference: 'PO-9', referenceDate: date, partyLedgerName: 'Acme Ltd', narration: 'note',
            isInvoice: true, objectView: 'Invoice Voucher View',
            entries: [{
                ledgerName: 'Acme Ltd', amount: -1180, isDebit: true,
                billAllocations: [{ name: 'B-1', billType: 'New Ref', amount: -1180, creditPeriod: 30 }],
                costCentreAllocations: [{ category: 'Primary Cost Category', name: 'Sales Team', amount: -1180 }],
            }],
            inventoryEntries: [{
                stockItemName: 'Widget', quantity: 2, rate: 500, amount: 1000, unit: 'Nos',
                godownName: 'Main Store', ledgerName: 'Sales A/c', isDebit: false,
            }],
        }],
    },
    'generic/delete-master': { targetCollection: 'Ledger', masters: ['Acme Ltd'] },
    'generic/invoke-action': { targetReport: 'Change Period', variables: [{ name: 'SVFromDate', value: '1-Apr-2024' }] },
    'generic/query-collection': {
        collection: 'Ledger', fromDate: date, toDate: date,
        fields: [{ name: 'Name', datatype: 'string' }, { name: 'OpeningBalance', datatype: 'amount' }],
        filters: [{ name: 'Exact', expression: '$$IsEqual:$Name:"Acme Ltd"' }],
    },
};

const inputs = { ...reportInputs, ...pushInputs };

test('every template renders as well formed XML', () => {
    for (const name of tallyTemplates.keys()) {
        assert.ok(name in inputs, `${name} has no render fixture, add one to tests/render.test.mjs`);

        const xml = renderTemplate(name, { targetCompany: 'Acme Ltd', ...inputs[name] });
        const result = XMLValidator.validate(xml);
        assert.equal(result, true, `${name} is not well formed: ${JSON.stringify(result)}`);
    }
});

test('a name containing a quote cannot break out of an XML attribute', () => {
    const xml = renderTemplate('push/master-ledger', {
        masters: [{ name: 'Ac"me <&> Co', mailingDetails: { country: 'India', state: 'Gujarat', applicableFrom: date } }],
    });

    assert.equal(XMLValidator.validate(xml), true);
    assert.ok(!xml.includes('Ac"me'), 'the raw quote reached the attribute');
});

test('a report template quotes the name it filters on', () => {
    const xml = renderTemplate('report/daybook', { ...reportInputs['report/daybook'], voucherType: 'Sales' });
    assert.match(xml, /\$\$IsEqual:\$VoucherTypeName:"Sales"/);
});
