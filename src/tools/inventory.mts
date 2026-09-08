/** Stock oriented tools: summary, balance and item statement. */

import { z } from 'zod';
import { fetchReport, queryCollection, renameObjectArrayProperties } from '../tally/index.mjs';
import { tdlQuoted } from '../escape.mjs';
import { cachedTable, columns, fail, guard, isoDate, ok, readOnly, targetCompany, type ToolModule } from './shared.mjs';
import { openingFirst } from './ledgers.mjs';

export const inventoryTools: ToolModule = ({ server, cache }) => {

    server.registerTool('stock-summary', {
        title: 'Stock Summary',
        description: 'fetches stock item summary with fields stock_item_name, stock_group_name, opening_quantity, opening_value, inward_quantity, inward_value, outward_quantity, outward_value, closing_quantity, closing_value, returns output cached in pglite postgres in-memory table (specified in tableID property). synonyms (name=stock item / parent=stock group) Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            fromDate: isoDate().describe('period start or from date'),
            toDate: isoDate().describe('period end or to date'),
            stockGroup: z.string().optional().describe('optional stock group name to filter stock summary results, validate it using list-master tool with collection as stock group if required'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const filters = new Map<string, string>();
        if (args.stockGroup)
            filters.set('Specific_StockGroup', `$$IsEqual:$Parent:${tdlQuoted(args.stockGroup)}`);

        const rows = renameObjectArrayProperties(
            await queryCollection('StockItem',
                ['Name', 'Parent', 'OpeningBalance', 'OpeningValue', 'InwardQuantity', 'InwardValue', 'OutwardQuantity', 'OutwardValue', 'ClosingBalance', 'ClosingValue', 'AffectsGrossProfit', 'SortPosition'],
                filters, args.targetCompany, new Date(args.fromDate), new Date(args.toDate)),
            new Map([['Name', 'stock_item_name'], ['Parent', 'stock_group_name'], ['OpeningBalance', 'opening_quantity'], ['OpeningValue', 'opening_value'], ['InwardQuantity', 'inward_quantity'], ['InwardValue', 'inward_value'], ['OutwardQuantity', 'outward_quantity'], ['OutwardValue', 'outward_value'], ['ClosingBalance', 'closing_quantity'], ['ClosingValue', 'closing_value']]));

        return cachedTable(cache, columns(
            ['stock_item_name', 'string'], ['stock_group_name', 'string'],
            ['opening_quantity', 'number'], ['opening_value', 'number'],
            ['inward_quantity', 'number'], ['inward_value', 'number'],
            ['outward_quantity', 'number'], ['outward_value', 'number'],
            ['closing_quantity', 'number'], ['closing_value', 'number']), rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate });
    }));

    server.registerTool('stock-item-balance', {
        title: 'Stock Item Balance',
        description: 'fetches stock item remaining quantity balance as on date, tool returns quantity and unit of measurement',
        inputSchema: {
            targetCompany: targetCompany(),
            itemName: z.string().describe('precise stock item name, always validate it using list-master tool with collection as stockitem'),
            toDate: isoDate().describe('as on date for which balance is required'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const filters = new Map([['Exact_StockItem', `$$IsEqual:$Name:${tdlQuoted(args.itemName)}`]]);
        const rows = await queryCollection('StockItem', ['ClosingBalance', 'Unit'], filters, args.targetCompany, undefined, new Date(args.toDate));
        return ok(rows.length ? { quantity: rows[0].ClosingBalance, unit_of_measurement: rows[0].Unit } : '');
    }));

    server.registerTool('stock-item-account', {
        title: 'Stock Item Account',
        description: 'fetches GL stock item account statement with voucher level details containing fields date, voucher_type, voucher_number, party_name, quantity, amount, narration, tracking_number, voucher_category. party_name = ledger_name. quantity = inward as positive and outward as negative. amount = debit is negative and credit is positive, narration = notes / remarks. for calculating closing balance of quantity, consider rows with tracking_number as empty as it is, but for rows with tracking_number having text value, then duplicate rows need to be removed by preparing intermediate output with aggregation of tracking_number and voucher_category with sum of quantity and then comparing quantity of Receipt Note with Purchase and Delivery Note with Sales to identify and remove the rows with Receipt Note and Delivery Note if they are found to be tracked fully / partially . returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            itemName: z.string().describe('stock item name, validate it using list-master tool with collection as stockitem'),
            fromDate: isoDate().describe('from or start date'),
            toDate: isoDate().describe('to or end date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        // checked first so a typo does not cost a full report run on Tally
        const exists = await queryCollection('StockItem', ['Name'], new Map([['Exact_StockItem', `$$IsEqual:$Name:${tdlQuoted(args.itemName)}`]]), args.targetCompany);
        if (exists.length === 0)
            return fail('No stock item found with the given name');

        const inputs = new Map([['fromDate', args.fromDate], ['toDate', args.toDate], ['itemName', args.itemName]]);
        if (args.targetCompany) inputs.set('targetCompany', args.targetCompany);

        const response = await fetchReport('stock-item-account', inputs);
        if (response.error) return fail(response.error);

        // the report emits party_ledger, the documented column name is party_name
        const rows = renameObjectArrayProperties(openingFirst(response.data), new Map([['party_ledger', 'party_name']]));

        return cachedTable(cache, columns(
            ['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'], ['party_name', 'string'],
            ['quantity', 'number'], ['amount', 'number'], ['narration', 'string'],
            ['tracking_number', 'string'], ['voucher_category', 'string']), rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate });
    }));
};
