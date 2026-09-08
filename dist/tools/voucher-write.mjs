/**
 * Tools that create, alter, cancel or delete transactions. Hidden when
 * BLOCK_WRITE is set.
 *
 * Everything is validated before anything is sent: an unbalanced voucher, an
 * unknown ledger or a missing identifier is reported as an error and no XML
 * reaches Tally at all.
 */
import { z } from 'zod';
import { fetchReport, importTemplate, queryCollection } from '../tally/index.mjs';
import { fail, guard, isoDate, ok, targetCompany, writes } from './shared.mjs';
/** Tally stores amounts to four decimals, so balancing is judged at that precision. */
const round4 = (value) => Math.round(value * 10000) / 10000;
const billAllocation = z.object({
    name: z.string().min(1).describe('bill number or reference number'),
    billType: z.enum(['New Ref', 'Agst Ref', 'Advance', 'On Account'])
        .describe('New Ref raises a new bill, Agst Ref settles an existing one, validate an existing bill name using the bills-outstanding tool'),
    amount: z.number().describe('amount of this bill reference, debit is negative and credit is positive, same sign as the ledger line it belongs to'),
    creditPeriod: z.number().int().min(0).optional().describe('optional credit period in days, applicable to a New Ref'),
});
const costCentreAllocation = z.object({
    category: z.string().min(1).describe('cost category name, validate it using list-master tool with collection as costcategory'),
    name: z.string().min(1).describe('cost centre name, validate it using list-master tool with collection as costcentre'),
    amount: z.number().describe('amount charged to this cost centre, same sign as the ledger line it belongs to'),
});
const ledgerEntry = z.object({
    ledgerName: z.string().min(1).describe('ledger name, validate it using list-master tool with collection as ledger'),
    amount: z.number().describe('amount of this line, debit is negative and credit is positive'),
    billAllocations: z.array(billAllocation).optional().describe('optional bill references, applicable only to a ledger with billwise tracking on'),
    costCentreAllocations: z.array(costCentreAllocation).optional().describe('optional cost centre allocations'),
});
const inventoryEntry = z.object({
    stockItemName: z.string().min(1).describe('stock item name, validate it using list-master tool with collection as stockitem'),
    quantity: z.number().positive().describe('quantity, always a positive number. the direction comes from the sign of amount, an outward line is a credit and an inward line is a debit'),
    rate: z.number().describe('rate per unit'),
    amount: z.number().describe('value of this line, debit is negative and credit is positive'),
    unit: z.string().optional().describe('optional unit of measurement, validate it using list-master tool with collection as unit'),
    godownName: z.string().optional().describe('optional godown or location name, validate it using list-master tool with collection as godown'),
    batchName: z.string().optional().describe('optional batch name, applicable only to a batch tracked item'),
    ledgerName: z.string().optional().describe('optional sales, purchase or stock ledger this line is posted to. supply it for an invoice, where the accounting side sits inside the inventory line and not in entries'),
});
const voucherInput = z.object({
    action: z.enum(['create', 'alter']).optional().describe('create adds a new voucher, alter replaces an existing one which needs guid. default is create'),
    guid: z.string().optional().describe('guid of the voucher to alter, as returned by the daybook or voucher-get tool. required when action is alter'),
    voucherType: z.string().min(1).describe('voucher type name such as Payment, Receipt, Contra, Journal, Sales or Purchase, validate it using list-master tool with collection as vouchertype'),
    date: isoDate().describe('voucher date'),
    effectiveDate: isoDate().optional().describe('optional effective date, defaults to the voucher date'),
    voucherNumber: z.string().optional().describe('optional voucher number, leave it out to let Tally number the voucher automatically'),
    reference: z.string().optional().describe('optional reference or supplier invoice number'),
    referenceDate: isoDate().optional().describe('optional date of the reference'),
    partyLedgerName: z.string().optional().describe('optional party ledger of the voucher, validate it using list-master tool with collection as ledger'),
    narration: z.string().optional().describe('optional notes or remarks'),
    isInvoice: z.boolean().optional().describe('optional, default false. set true for a sales or purchase entered in invoice mode with inventory lines'),
    entries: z.array(ledgerEntry).describe('ledger lines of the voucher. the sum of every amount, including the amount of any inventory line that carries a ledgerName, must be zero'),
    inventoryEntries: z.array(inventoryEntry).optional().describe('optional stock lines, applicable to a voucher type that affects inventory'),
});
/** Amounts that have to add up to zero for the voucher to be accepted by Tally. */
function balanceOf(voucher) {
    let total = voucher.entries.reduce((sum, entry) => sum + entry.amount, 0);
    for (const item of voucher.inventoryEntries ?? [])
        if (item.ledgerName)
            total += item.amount;
    return round4(total);
}
/** Every ledger name a voucher refers to, so all of them can be checked in one query. */
function ledgerNamesOf(voucher) {
    const names = voucher.entries.map((entry) => entry.ledgerName);
    if (voucher.partyLedgerName)
        names.push(voucher.partyLedgerName);
    for (const item of voucher.inventoryEntries ?? [])
        if (item.ledgerName)
            names.push(item.ledgerName);
    return names;
}
/** Reports every problem at once, so a caller does not fix them one round trip at a time. */
function validate(voucher, index, known) {
    const problems = [];
    const at = `voucher ${index + 1}`;
    if (voucher.action === 'alter' && !voucher.guid)
        problems.push(`${at}: guid is required to alter a voucher`);
    if (!known.voucherTypes.has(voucher.voucherType))
        problems.push(`${at}: no voucher type named ${voucher.voucherType}`);
    if (voucher.entries.length === 0 && (voucher.inventoryEntries ?? []).length === 0)
        problems.push(`${at}: a voucher needs at least one entry`);
    for (const name of new Set(ledgerNamesOf(voucher)))
        if (!known.ledgers.has(name))
            problems.push(`${at}: no ledger named ${name}`);
    for (const item of voucher.inventoryEntries ?? [])
        if (!known.stockItems.has(item.stockItemName))
            problems.push(`${at}: no stock item named ${item.stockItemName}`);
    const balance = balanceOf(voucher);
    if (balance !== 0)
        problems.push(`${at}: entries do not balance, debits and credits differ by ${Math.abs(balance)}`);
    for (const entry of voucher.entries) {
        const bills = entry.billAllocations ?? [];
        if (bills.length === 0)
            continue;
        const allocated = round4(bills.reduce((sum, bill) => sum + bill.amount, 0));
        if (allocated !== round4(entry.amount))
            problems.push(`${at}: bill references on ${entry.ledgerName} add up to ${allocated}, but the line is ${round4(entry.amount)}`);
    }
    return problems;
}
/** Shapes one voucher the way templates/push/voucher.njk expects it. */
function toVoucherPayload(voucher, action) {
    const date = new Date(voucher.date);
    return {
        action,
        guid: voucher.guid,
        voucherType: voucher.voucherType,
        date,
        effectiveDate: voucher.effectiveDate ? new Date(voucher.effectiveDate) : date,
        voucherNumber: voucher.voucherNumber,
        reference: voucher.reference,
        referenceDate: voucher.referenceDate ? new Date(voucher.referenceDate) : undefined,
        partyLedgerName: voucher.partyLedgerName,
        narration: voucher.narration,
        isInvoice: voucher.isInvoice === true,
        objectView: voucher.isInvoice === true ? 'Invoice Voucher View' : 'Accounting Voucher View',
        entries: (action === 'Cancel' || action === 'Delete') ? [] : voucher.entries.map((entry) => ({
            ledgerName: entry.ledgerName,
            amount: entry.amount,
            isDebit: entry.amount < 0,
            billAllocations: entry.billAllocations,
            costCentreAllocations: entry.costCentreAllocations,
        })),
        inventoryEntries: (action === 'Cancel' || action === 'Delete') ? [] : (voucher.inventoryEntries ?? []).map((item) => ({
            ...item,
            isDebit: item.amount < 0,
        })),
    };
}
/** Reads the daybook for one date, used to check a guid exists and to read a voucher back. */
async function daybookOn(date, company) {
    const inputs = new Map([
        ['fromDate', date], ['toDate', date],
        ['voucherType', ''], ['partyLedgerName', ''],
        ['includeCancelled', true], ['includeOptional', true],
    ]);
    if (company)
        inputs.set('targetCompany', company);
    const response = await fetchReport('daybook', inputs);
    if (response.error)
        throw new Error(response.error);
    return Array.isArray(response.data) ? response.data : [];
}
const nameSet = async (collection, company) => new Set((await queryCollection(collection, ['Name'], new Map(), company)).map((row) => row.Name));
export const voucherWriteTools = ({ server }) => {
    server.registerTool('voucher-create-update', {
        title: 'Create or Update Voucher',
        description: 'creates new transactions or replaces existing ones in Tally Prime. amount = debit is negative and credit is positive, and every amount of a voucher must add up to zero. every ledger, voucher type and stock item is validated before anything is sent, so an invalid batch changes nothing in Tally. an alter replaces the whole voucher, so send every line again, not only the changed ones. returns the counters Tally reports and, unless verify is false, the vouchers read back from the daybook. if the call times out the outcome is unknown, read the daybook for that date before sending it again, or a duplicate will be created',
        inputSchema: {
            targetCompany: targetCompany(),
            vouchers: z.array(voucherInput).min(1).describe('array of vouchers to create or alter'),
            verify: z.boolean().optional().describe('optional, default true. reads the affected dates back from the daybook after the import and returns what Tally stored'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const vouchers = args.vouchers;
        const needsStock = vouchers.some((voucher) => (voucher.inventoryEntries ?? []).length > 0);
        const known = {
            ledgers: await nameSet('Ledger', args.targetCompany),
            voucherTypes: await nameSet('VoucherType', args.targetCompany),
            stockItems: needsStock ? await nameSet('StockItem', args.targetCompany) : new Set(),
        };
        const problems = vouchers.flatMap((voucher, index) => validate(voucher, index, known));
        if (problems.length > 0)
            return fail(`Nothing was sent to Tally. Correct the following and call again:\n${problems.join('\n')}`);
        const input = new Map();
        input.set('vouchers', vouchers.map((voucher) => toVoucherPayload(voucher, voucher.action === 'alter' ? 'Alter' : 'Create')));
        if (args.targetCompany)
            input.set('targetCompany', args.targetCompany);
        const status = await importTemplate('voucher', input);
        if (args.verify === false)
            return ok(status);
        // read back what Tally kept, so a counter of 1 is not taken as proof on its own
        const dates = [...new Set(vouchers.map((voucher) => voucher.date))];
        const stored = [];
        for (const date of dates)
            for (const row of await daybookOn(date, args.targetCompany))
                if (vouchers.some((voucher) => voucher.date === date && ((voucher.guid && voucher.guid === row.guid)
                    || (voucher.voucherNumber && voucher.voucherNumber === row.voucher_number && voucher.voucherType === row.voucher_type))))
                    stored.push(row);
        return ok({
            ...status,
            verified: stored,
            note: 'verified lists the vouchers found again in the daybook, matched on guid, or on voucher number and voucher type. a created voucher whose number Tally assigned automatically cannot be matched this way and will be absent',
        });
    }));
    server.registerTool('voucher-cancel-delete', {
        title: 'Cancel or Delete Voucher',
        description: 'cancels or deletes existing transactions in Tally Prime. a cancelled voucher keeps its number and stays visible in the daybook with no entries, a deleted voucher is removed. every guid is looked up in the daybook first, so an unknown one changes nothing in Tally. this cannot be undone',
        inputSchema: {
            targetCompany: targetCompany(),
            mode: z.enum(['cancel', 'delete']).describe('cancel keeps the voucher number, delete removes the voucher'),
            vouchers: z.array(z.object({
                guid: z.string().min(1).describe('guid of the voucher, as returned by the daybook or voucher-get tool'),
                date: isoDate().describe('date of the voucher, as returned by the daybook or voucher-get tool'),
            })).min(1).describe('array of vouchers to cancel or delete'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const found = new Map();
        for (const date of new Set(args.vouchers.map((voucher) => voucher.date)))
            for (const row of await daybookOn(date, args.targetCompany))
                found.set(row.guid, row);
        const missing = args.vouchers.filter((voucher) => !found.has(voucher.guid));
        if (missing.length > 0)
            return fail(`Nothing was sent to Tally. No voucher found for: ${missing.map((v) => `${v.guid} on ${v.date}`).join(', ')}. Check the guid and the date using the daybook tool`);
        const action = args.mode === 'cancel' ? 'Cancel' : 'Delete';
        const input = new Map();
        input.set('vouchers', args.vouchers.map((voucher) => toVoucherPayload({
            guid: voucher.guid,
            date: voucher.date,
            voucherType: found.get(voucher.guid).voucher_type,
            entries: [],
        }, action)));
        if (args.targetCompany)
            input.set('targetCompany', args.targetCompany);
        return ok(await importTemplate('voucher', input));
    }));
};
//# sourceMappingURL=voucher-write.mjs.map