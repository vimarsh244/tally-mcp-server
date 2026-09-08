/** Ledger oriented tools: master lists, balances, statements and outstanding bills. */
import { z } from 'zod';
import { fetchReport, queryCollection, renameObjectArrayProperties } from '../tally/index.mjs';
import { tdlQuoted } from '../escape.mjs';
import { cachedTable, collectionNames, columns, fail, guard, isoDate, ok, readOnly, targetCompany } from './shared.mjs';
const MASTER_COLLECTIONS = ['group', 'ledger', 'vouchertype', 'unit', 'godown', 'stockgroup', 'stockitem', 'costcategory', 'costcentre', 'attendancetype', 'company', 'currency', 'gstin', 'gstclassification'];
export const ledgerTools = ({ server, cache }) => {
    server.registerTool('list-master', {
        title: 'List Masters',
        description: 'fetches list of masters from Tally Prime collection e.g. group, ledger, vouchertype, unit, godown, stockgroup, stockitem, costcategory, costcentre, attendancetype, company, currency, gstin, gstclassification returns output in JSON string array in the property list',
        inputSchema: {
            targetCompany: targetCompany(),
            collection: z.enum(MASTER_COLLECTIONS),
            containsFilter: z.string().optional().describe('optional filter to apply on name field with contains operator to filter results with respective name value or keywords, case insensitive'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const collection = collectionNames.find((item) => item.toLowerCase() === args.collection.toLowerCase());
        if (!collection)
            return fail('Invalid collection name');
        const filters = new Map();
        if (args.containsFilter)
            filters.set('Search_Contains', `$Name CONTAINS ${tdlQuoted(args.containsFilter)}`);
        const rows = await queryCollection(collection, ['Name'], filters, args.targetCompany);
        return ok({ list: rows.map((item) => item.Name) });
    }));
    server.registerTool('ledger-balance', {
        title: 'Ledger Balance',
        description: 'fetches ledger closing balance as on date, negative is debit and positive is credit, display Dr for Debit or Cr for Credit after the amount for better readability, instead of negative amount flip Debit or Credit to make it positive',
        inputSchema: {
            targetCompany: targetCompany(),
            ledgerName: z.string().describe('precise ledger name, always validate it using list-master tool with collection as ledger'),
            toDate: isoDate().describe('as on date for which balance is required'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const filters = new Map([['Exact_Ledger', `$$IsEqual:$Name:${tdlQuoted(args.ledgerName)}`]]);
        const rows = await queryCollection('Ledger', ['ClosingBalance'], filters, args.targetCompany, undefined, new Date(args.toDate));
        return rows.length > 0 ? ok({ amount: rows[0].ClosingBalance }) : fail('No ledger found');
    }));
    server.registerTool('bills-outstanding', {
        title: 'Bills Outstanding',
        description: 'fetches pending overdue outstanding bills receivable or payable as on date with fields bill_date,reference_number,outstanding_amount,party_name,overdue_days. outstanding_amount = Debit is negative and Credit is positive. party_name = ledger_name. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            nature: z.enum(['receivable', 'payable']),
            toDate: isoDate().describe('as on date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const primaryGroup = args.nature === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors';
        const filters = new Map([['Nature', `$$IsEqual:($_PrimaryGroup:Group:($Parent:Ledger:$Parent)):"${primaryGroup}"`]]);
        const rows = renameObjectArrayProperties(await queryCollection('Bill', ['BillDate', 'Name', 'ClosingBalance', 'Parent', '_OverDueDays'], filters, args.targetCompany, undefined, new Date(args.toDate)), new Map([['BillDate', 'bill_date'], ['Name', 'reference_number'], ['ClosingBalance', 'outstanding_amount'], ['Parent', 'party_name'], ['_OverDueDays', 'overdue_days']]));
        return cachedTable(cache, columns(['bill_date', 'date'], ['reference_number', 'string'], ['outstanding_amount', 'number'], ['party_name', 'string'], ['overdue_days', 'number']), rows, { company: args.targetCompany, toDate: args.toDate });
    }));
    server.registerTool('ledger-account', {
        title: 'Ledger Account',
        description: 'fetches GL ledger account statement with voucher level details containing fields guid, date, voucher_type, voucher_number, alternate_ledger, party_name, amount, narration . amount = debit is negative and credit is positive. alternate_ledger = if amount is credit then ledger by which it is debited and vice-a-versa (in case of multiple ledgers first one is displayed). returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            ledgerName: z.string().describe('ledger name, always verify if ledger exists using list-master tool with collection as ledger'),
            fromDate: isoDate().describe('from or start date'),
            toDate: isoDate().describe('to or end date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        // checked first so a typo does not cost a full report run on Tally
        const exists = await queryCollection('Ledger', ['Name'], new Map([['Exact_Ledger', `$$IsEqual:$Name:${tdlQuoted(args.ledgerName)}`]]), args.targetCompany);
        if (exists.length === 0)
            return fail('No ledger found with the given name');
        const inputs = new Map([['fromDate', args.fromDate], ['toDate', args.toDate], ['ledgerName', args.ledgerName]]);
        if (args.targetCompany)
            inputs.set('targetCompany', args.targetCompany);
        const response = await fetchReport('ledger-account', inputs);
        if (response.error)
            return fail(response.error);
        // the report emits party_ledger, the documented column name is party_name
        const rows = renameObjectArrayProperties(openingFirst(response.data), new Map([['party_ledger', 'party_name']]));
        return cachedTable(cache, columns(['guid', 'string'], ['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'], ['alternate_ledger', 'string'], ['party_name', 'string'], ['amount', 'number'], ['narration', 'string']), rows, { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate });
    }));
};
/** Tally returns the opening balance row last, but it belongs at the top. */
export function openingFirst(data) {
    if (!Array.isArray(data) || data.length === 0)
        return [];
    const rows = data.slice();
    rows.unshift(rows.pop());
    return rows;
}
//# sourceMappingURL=ledgers.mjs.map