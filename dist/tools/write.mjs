/** Tools that create, update or delete Tally masters. Hidden when BLOCK_WRITE is set. */
import { z } from 'zod';
import { deleteMasters, importMasters, queryCollection } from '../tally/index.mjs';
import { collectionNames, fail, guard, ok, targetCompany, writes } from './shared.mjs';
const mailingDetails = z.object({
    name: z.string().optional().describe('business name for mailing details, set it undefined to keep it unchanged, set it blank to reset it to Not Applicable'),
    country: z.string().describe('country for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
    state: z.string().describe('state for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
    address: z.string().optional().describe('address for mailing details, set it blank to reset it'),
    pincode: z.string().regex(/^\d{6}$/).optional().describe('pincode for mailing details 6 digit number, set it blank to reset it, set it undefined to keep it unchanged'),
});
const gstRegistrationDetails = z.object({
    // 15 characters: 2 digit state code, 10 character PAN, then 3 characters
    gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/).describe('GSTIN or GST number, 15 characters: 2 digit state code, 10 character PAN, then 3 characters'),
    registrationType: z.enum(['Composition', 'Regular', 'Unregistered/Consumer', 'Government entity / TDS', 'Regular - SEZ', 'Regular-Deemed Exporter', 'Regular-Exports (EOU)', 'e-Commerce Operator', 'Input Service Distributor', 'Embassy/UN Body', 'Non-Resident Taxpayer']).optional().describe('GST registration type'),
    placeOfSupply: z.string().optional().describe('place of supply for GST, validate it using query-option-values tool with input optionName as country-state with value of state property, set it blank to reset it to Not Applicable, set it undefined to keep it unchanged'),
});
const ledgerMaster = z.object({
    name: z.string().describe('ledger name or updated ledger name for modify / update'),
    _name: z.string().optional().describe('old ledger name to modify / update, validate if ledger exists using list-master tool with collection as ledger'),
    parent: z.string().optional().describe('group name for the ledger, validate if group exists using list-master tool with collection as group'),
    openingBalance: z.number().optional().describe('optional opening balance for the ledger debit is negative and credit is positive'),
    isBillWise: z.boolean().optional().describe('optional billwise or bill by bill tracking is enabled for the ledger, default is false, set it undefined to keep it unchanged'),
    billCreditPeriod: z.number().optional().describe('optional bill credit period in number of days, applicable only if isBillWise is true, set it undefined to keep it unchanged'),
    mailingDetails: mailingDetails.optional().describe('optional mailing details for the ledger'),
    gstRegistrationDetails: gstRegistrationDetails.optional().describe('optional GST registration details for the ledger, applicable only if country in mailing details is India'),
});
/** Copies only the properties the caller actually supplied, so unset fields stay unchanged in Tally. */
function toLedgerPayload(master, booksBeginFrom) {
    const payload = {};
    if (master._name)
        payload._name = master._name;
    if (master.name)
        payload.name = master.name;
    if (master.parent)
        payload.parent = master.parent;
    if (master.openingBalance !== undefined)
        payload.openingBalance = master.openingBalance;
    if (master.mailingDetails)
        payload.mailingDetails = { ...master.mailingDetails, applicableFrom: booksBeginFrom };
    if (master.gstRegistrationDetails)
        payload.gstRegistrationDetails = { ...master.gstRegistrationDetails, applicableFrom: booksBeginFrom };
    if (master.isBillWise !== undefined)
        payload.isBillWise = master.isBillWise;
    if (master.isBillWise === true && typeof master.billCreditPeriod === 'number')
        payload.billCreditPeriod = Math.trunc(master.billCreditPeriod);
    return payload;
}
export const writeTools = ({ server }) => {
    server.registerTool('ledger-create-update', {
        title: 'Create or Update Ledger',
        description: 'create or update ledger master data in Tally Prime, returns success count of created and / or altered records',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(ledgerMaster).describe('array of master data objects to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => {
        if (!Array.isArray(args.masters) || args.masters.length === 0)
            return fail('masters array is required with at least one master object to create or update');
        const companies = await queryCollection('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map());
        if (companies.length === 0)
            return fail('No company found to determine books begin from date');
        const company = args.targetCompany
            ? companies.find((item) => item.Name === args.targetCompany)
            : companies.find((item) => item.IsActiveCompany);
        if (!company)
            return fail(args.targetCompany
                ? `No company found with the name ${args.targetCompany}. Kindly validate it using list-master tool with collection as company`
                : 'No active company found in Tally. Kindly open a company or pass targetCompany');
        const input = new Map();
        input.set('masters', args.masters.map((master) => toLedgerPayload(master, company.BooksFrom)));
        if (args.targetCompany)
            input.set('targetCompany', args.targetCompany);
        return ok(await importMasters('master-ledger', input));
    }));
    server.registerTool('delete-master', {
        title: 'Delete Master',
        description: 'deletes a master object from selected collection in Tally Prime and returns success count of deleted records',
        inputSchema: {
            targetCompany: targetCompany(),
            collection: z.enum(collectionNames).describe('target collection for deletion, validate collection and object name using list-master tool where applicable'),
            name: z.array(z.string()).describe('list of name of that specific master object from that collection to delete, validate it using list-master tool with collection as the target collection before calling this tool'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const collection = args.collection.trim();
        // checked first so a typo does not reach Tally as a delete
        const existing = await queryCollection(collection, ['Name'], new Map(), args.targetCompany);
        const missing = args.name.filter((name) => !existing.some((item) => item.Name === name));
        if (missing.length > 0)
            return fail(`No master object found with the given name(s) in the ${collection} collection: ${missing.join(', ')}. Kindly validate it using list-master tool`);
        return ok(await deleteMasters(collection, args.name, args.targetCompany));
    }));
};
//# sourceMappingURL=write.mjs.map