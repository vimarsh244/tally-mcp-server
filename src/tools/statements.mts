/** Financial statements: chart of accounts, trial balance, profit and loss, balance sheet. */

import { z } from 'zod';
import { queryCollection, renameObjectArrayProperties } from '../tally/index.mjs';
import { tdlQuoted } from '../escape.mjs';
import { cachedTable, columns, guard, isoDate, readOnly, targetCompany, type ToolModule } from './shared.mjs';

export const statementTools: ToolModule = ({ server, cache }) => {

    server.registerTool('chart-of-accounts', {
        title: 'Chart of Accounts',
        description: 'fetches chart of accounts or GL hierarchy with fields ledger_name, group_name, primary_group, bs_pl, dr_cr, affects_gross_profit, sort_position. the column bs_pl will have values false = Balance Sheet / true = Profit Loss. Column dr_cr as value true = Debit / false = Credit. primary_group is the primary group of parent or group, under which ledger is nested. The columns group and parent are tree structure represented in flat format. The column affects_gross_profit has values true / false, it is used to determine if ledger under this group will affect gross profit or not. sort_position determines position or placement order with respect to items of same level for display, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: { targetCompany: targetCompany() },
        annotations: readOnly,
    }, guard(async (args) => {
        const rows = renameObjectArrayProperties(
            await queryCollection('Ledger', ['Name', 'Parent', '_PrimaryGroup', 'IsRevenue', 'IsDeemedPositive', 'AffectsGrossProfit', 'SortPosition'], new Map(), args.targetCompany),
            new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['_PrimaryGroup', 'primary_group'], ['IsRevenue', 'bs_pl'], ['IsDeemedPositive', 'dr_cr'], ['AffectsGrossProfit', 'affects_gross_profit'], ['SortPosition', 'sort_position']]));

        return cachedTable(cache, columns(
            ['ledger_name', 'string'], ['group_name', 'string'], ['primary_group', 'string'],
            ['bs_pl', 'boolean'], ['dr_cr', 'boolean'], ['affects_gross_profit', 'boolean'], ['sort_position', 'number']), rows,
            { company: args.targetCompany });
    }));

    server.registerTool('trial-balance', {
        title: 'Trial Balance',
        description: 'fetches trial balance with fields ledger_name, group_name (blank if Profit & Loss), opening_balance, net_debit, net_credit, closing_balance. opening_balance and closing_balance negative is debit and positive is credit. checks holds the total of each column, and on a balanced set of books the opening and closing totals are zero. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            fromDate: isoDate().describe('from or start date'),
            toDate: isoDate().describe('to or end date'),
            group_name: z.string().optional().describe('optional group name to filter trial balance results, validate it using list-master tool with collection as group if required'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const filters = new Map<string, string>();
        if (args.group_name)
            filters.set('Specific_Group', `$$IsEqual:$Parent:${tdlQuoted(args.group_name)}`);

        const rows = renameObjectArrayProperties(
            await queryCollection('Ledger', ['Name', 'Parent', 'OpeningBalance', 'DebitTotals', 'CreditTotals', 'ClosingBalance'], filters, args.targetCompany, new Date(args.fromDate), new Date(args.toDate)),
            new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['OpeningBalance', 'opening_balance'], ['DebitTotals', 'net_debit'], ['CreditTotals', 'net_credit'], ['ClosingBalance', 'closing_balance']]));

        return cachedTable(cache, columns(
            ['ledger_name', 'string'], ['group_name', 'string'], ['opening_balance', 'amount'],
            ['net_debit', 'amount'], ['net_credit', 'amount'], ['closing_balance', 'amount']), rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate },
            { checks: {
                openingBalanceTotal: total(rows, 'opening_balance'),
                netDebitTotal: total(rows, 'net_debit'),
                netCreditTotal: total(rows, 'net_credit'),
                closingBalanceTotal: total(rows, 'closing_balance'),
            } });
    }));

    server.registerTool('profit-loss', {
        title: 'Profit and Loss',
        description: 'fetches profit and loss statement with fields like ledger_name, group_name, closing_balance. closing_balance negative is debit or expense and positive is credit or income. closing stock to be treated as credit, kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. for detailed ledger level analysis call trial-balance tool, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            fromDate: isoDate().describe('from or start date'),
            toDate: isoDate().describe('to or end date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const from = new Date(args.fromDate);
        const to = new Date(args.toDate);
        const rows: any[] = [];

        const ledgers = renameObjectArrayProperties(
            await queryCollection('Ledger', ['Name', 'Parent', 'ClosingBalance'], new Map([['PL_Group', '$IsRevenue']]), args.targetCompany, from, to),
            new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['ClosingBalance', 'closing_balance']]));

        const stock = await queryCollection('Group', ['Name', 'OpeningBalance', 'ClosingBalance'], new Map([['StockTypeGroup', '$$IsEqual:$Name:"Stock-in-Hand"']]), args.targetCompany, from, to);
        if (stock.length > 0) {
            rows.push({ ledger_name: 'Opening Stock', group_name: 'Stock-in-Hand', closing_balance: stock[0].OpeningBalance });
            rows.push({ ledger_name: 'Closing Stock', group_name: 'Stock-in-Hand', closing_balance: -stock[0].ClosingBalance });
        }
        rows.push(...ledgers);

        return cachedTable(cache, columns(['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']), rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate },
            { checks: { closingBalanceTotal: total(rows, 'closing_balance') } });
    }));

    server.registerTool('balance-sheet', {
        title: 'Balance Sheet',
        description: 'fetches balance sheet with fields like ledger_name, group_name (blank if Profit & Loss A/c), closing_balance. closing balance negative is debit or asset and positive is credit or liability. Profit & Loss A/c carries the result of the period and is reported once, with a blank group_name. checks.closingBalanceTotal adds every row up and should be zero on a balanced set of books. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            fromDate: isoDate().describe('period start or from date'),
            toDate: isoDate().describe('period end or to date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const from = new Date(args.fromDate);
        const to = new Date(args.toDate);

        const rows: any[] = renameObjectArrayProperties(
            await queryCollection('Ledger', ['Name', 'Parent', 'ClosingBalance'], new Map([['BS_Group', 'NOT $IsRevenue'], ['Excl_Stock', 'NOT $$IsGroupStock']]), args.targetCompany, from, to),
            new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['ClosingBalance', 'closing_balance']]));

        // the ledger query already returns Profit & Loss A/c, and a second query
        // used to add it a second time, so every balance sheet carried the line
        // twice. It is presented on its own, so it keeps no group name
        for (const row of rows)
            if (row.ledger_name === PROFIT_AND_LOSS) row.group_name = '';

        const stock = await queryCollection('Group', ['Name', 'ClosingBalance'], new Map([['StockTypeGroup', '$$IsEqual:$Name:"Stock-in-Hand"']]), args.targetCompany, from, to);
        if (stock.length > 0)
            rows.push({ ledger_name: 'Closing Stock', group_name: 'Stock-in-Hand', closing_balance: stock[0].ClosingBalance });

        return cachedTable(cache, columns(['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']), rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate },
            { checks: { closingBalanceTotal: total(rows, 'closing_balance') } });
    }));
};

/** Tally's own name for the ledger that carries the result of the year. */
const PROFIT_AND_LOSS = 'Profit & Loss A/c';

/**
 * Adds a column up at the precision Tally keeps, so a statement that does not
 * balance says so in the result instead of leaving the caller to notice.
 */
function total(rows: any[], column: string): number {
    const sum = rows.reduce((running, row) => running + (Number(row[column]) || 0), 0);
    return Math.round(sum * 10000) / 10000;
}
