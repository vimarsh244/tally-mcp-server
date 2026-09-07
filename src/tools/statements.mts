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
            ['bs_pl', 'boolean'], ['dr_cr', 'boolean'], ['affects_gross_profit', 'boolean'], ['sort_position', 'number']), rows);
    }));

    server.registerTool('trial-balance', {
        title: 'Trial Balance',
        description: 'fetches trial balance with fields ledger_name, group_name (blank if Profit & Loss), opening_balance, net_debit, net_credit, closing_balance. opening_balance and closing_balance negative is debit and positive is credit. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
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
            ['net_debit', 'amount'], ['net_credit', 'amount'], ['closing_balance', 'amount']), rows);
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

        return cachedTable(cache, columns(['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']), rows);
    }));

    server.registerTool('balance-sheet', {
        title: 'Balance Sheet',
        description: 'fetches balance sheet with fields like ledger_name, group_name (blank if Profit & Loss A/c), closing_balance. closing balance negative is debit or asset and positive is credit or liability. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis',
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

        const stock = await queryCollection('Group', ['Name', 'ClosingBalance'], new Map([['StockTypeGroup', '$$IsEqual:$Name:"Stock-in-Hand"']]), args.targetCompany, from, to);
        if (stock.length > 0)
            rows.push({ ledger_name: 'Closing Stock', group_name: 'Stock-in-Hand', closing_balance: stock[0].ClosingBalance });

        const profitLoss = await queryCollection('Ledger', ['ClosingBalance'], new Map([['PL_Ledger', '$$IsEqual:$Name:"Profit & Loss A/c"']]), args.targetCompany, from, to);
        if (profitLoss.length > 0)
            rows.push({ ledger_name: 'Profit & Loss A/c', group_name: '', closing_balance: profitLoss[0].ClosingBalance });

        return cachedTable(cache, columns(['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']), rows);
    }));
};
