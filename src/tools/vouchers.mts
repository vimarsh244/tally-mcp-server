/**
 * Voucher oriented read tools: the daybook, and one complete voucher.
 *
 * A ledger statement shows only the part of a voucher that touches that one
 * ledger. These tools read the voucher itself, so every ledger line, bill
 * reference and inventory line of a transaction is visible.
 */

import { z } from 'zod';
import { fetchReport, renameObjectArrayProperties } from '../tally/index.mjs';
import { tdlString } from '../escape.mjs';
import { cachedTable, columns, fail, guard, isoDate, ok, readOnly, targetCompany, type ToolResult, type ToolModule } from './shared.mjs';

/** Upper bound on one daybook page, so a full year cannot arrive as one response. */
const MAX_PAGE_SIZE = 1000;

/** Runs one of the voucher reports for a single voucher and returns its rows. */
async function voucherReport(report: string, guid: string, date: string, company?: string): Promise<any[]> {
    const inputs = new Map<string, any>([['fromDate', date], ['toDate', date], ['voucherGuid', tdlString(guid)]]);
    if (company) inputs.set('targetCompany', company);

    const response = await fetchReport(report, inputs);
    if (response.error) throw new Error(response.error);
    return Array.isArray(response.data) ? response.data : [];
}

export const voucherTools: ToolModule = ({ server, cache }) => {

    server.registerTool('daybook', {
        title: 'Daybook',
        description: 'fetches the daybook, one row per voucher entered in the period, with fields guid, date, voucher_type, voucher_number, reference, party_name, amount, narration, is_cancelled, is_optional. amount = total debit value of the voucher, always positive, and is zero for a voucher with no accounting entry such as a stock journal. guid is the stable identifier to pass to the voucher-get tool. results are paged, so read rowCount, hasMore and nextOffset from the response and call again with offset to continue. returns output cached in pglite postgres in-memory table (specified in tableID property), and a small page is also returned inline under rows. Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            targetCompany: targetCompany(),
            fromDate: isoDate().describe('from or start date'),
            toDate: isoDate().describe('to or end date'),
            voucherType: z.string().optional().describe('optional exact voucher type name to filter on, validate it using list-master tool with collection as vouchertype'),
            partyLedgerName: z.string().optional().describe('optional exact party ledger name to filter on, validate it using list-master tool with collection as ledger'),
            includeCancelled: z.boolean().optional().describe('optional, default false. cancelled vouchers keep their number but carry no entries'),
            includeOptional: z.boolean().optional().describe('optional, default false. optional vouchers do not affect the books'),
            limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`optional page size, default and maximum ${MAX_PAGE_SIZE}`),
            offset: z.number().int().min(0).optional().describe('optional number of rows to skip, default 0. use nextOffset from the previous call'),
            includeNarration: z.boolean().optional().describe('optional, default true. set false on a long period to have Tally skip the narration text, which is the largest field of a daybook. the narration column is then empty'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const inputs = new Map<string, any>([
            ['fromDate', args.fromDate],
            ['toDate', args.toDate],
            // the value lands inside a quoted TDL literal, which has no escape character
            ['voucherType', tdlString(args.voucherType ?? '')],
            ['partyLedgerName', tdlString(args.partyLedgerName ?? '')],
            ['includeCancelled', args.includeCancelled === true],
            ['includeOptional', args.includeOptional === true],
            ['includeNarration', args.includeNarration !== false],
        ]);
        if (args.targetCompany) inputs.set('targetCompany', args.targetCompany);

        const response = await fetchReport('daybook', inputs);
        if (response.error) return fail(response.error);

        const all = renameObjectArrayProperties(
            Array.isArray(response.data) ? response.data : [],
            new Map([['party_ledger', 'party_name']]));

        // paging happens here, after the export. It bounds the response, it does
        // not reduce the work Tally does, which stays proportional to the period
        const offset = args.offset ?? 0;
        const limit = args.limit ?? MAX_PAGE_SIZE;
        const page = all.slice(offset, offset + limit);
        const hasMore = offset + page.length < all.length;

        return cachedTable(cache, columns(
            ['guid', 'string'], ['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'],
            ['reference', 'string'], ['party_name', 'string'], ['amount', 'number'], ['narration', 'string'],
            ['is_cancelled', 'boolean'], ['is_optional', 'boolean']), page,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate }, {
                totalRowCount: all.length,
                hasMore,
                nextOffset: hasMore ? offset + page.length : null,
            });
    }));

    server.registerTool('voucher-get', {
        title: 'Get Voucher',
        description: 'fetches one complete voucher by its guid, with every ledger line, bill reference and inventory line. use the daybook tool or the ledger-account tool first to obtain the guid and the date. amount = debit is negative and credit is positive, on the voucher itself and on every line. the result is returned inline as JSON, not as a cached table, because one voucher is small',
        inputSchema: {
            targetCompany: targetCompany(),
            voucherGuid: z.string().min(1).describe('guid of the voucher, as returned by the daybook or ledger-account tool'),
            date: isoDate().describe('date of the voucher, as returned by the daybook or ledger-account tool. Tally reads a voucher through a reporting period, so the date is needed to find it'),
            includeBills: z.boolean().optional().describe('optional, default true. set false to skip the bill reference lookup and save one call to Tally'),
            includeInventory: z.boolean().optional().describe('optional, default true. set false to skip the inventory lookup and save one call to Tally'),
        },
        annotations: readOnly,
    }, guard(async (args): Promise<ToolResult> => {
        const header = new Map<string, any>([
            ['fromDate', args.date],
            ['toDate', args.date],
            ['voucherType', ''],
            ['partyLedgerName', ''],
            // a cancelled or optional voucher must still be readable by guid
            ['includeCancelled', true],
            ['includeOptional', true],
            ['includeNarration', true],
        ]);
        if (args.targetCompany) header.set('targetCompany', args.targetCompany);

        const dayResponse = await fetchReport('daybook', header);
        if (dayResponse.error) return fail(dayResponse.error);

        const rows: any[] = Array.isArray(dayResponse.data) ? dayResponse.data : [];
        const voucher = rows.find((row) => row.guid === args.voucherGuid);
        if (!voucher)
            return fail(`No voucher found with guid ${args.voucherGuid} on ${args.date}. Check the date, it must be the date of the voucher itself`);

        const [renamed] = renameObjectArrayProperties([voucher], new Map([['party_ledger', 'party_name']]));

        const payload: Record<string, unknown> = {
            voucher: renamed,
            ledger_entries: (await voucherReport('voucher-ledger-entries', args.voucherGuid, args.date, args.targetCompany))
                .map(({ guid: _guid, ...entry }) => entry),
        };

        if (args.includeBills !== false)
            payload.bill_allocations = (await voucherReport('voucher-bill-allocations', args.voucherGuid, args.date, args.targetCompany))
                .map(({ guid: _guid, ...bill }) => bill);

        if (args.includeInventory !== false)
            payload.inventory_entries = (await voucherReport('voucher-inventory-entries', args.voucherGuid, args.date, args.targetCompany))
                .map(({ guid: _guid, ...item }) => item);

        return ok(payload);
    }));
};
