/** Tools that create, update or delete Tally masters. Hidden when BLOCK_WRITE is set. */
import { z } from 'zod';
import { deleteMasters, importMasters, queryCollection } from '../tally/index.mjs';
import { collectionNames, fail, guard, isoDate, ok, targetCompany, writes } from './shared.mjs';
/** Tally keeps an address as a list of lines, but one line is the common case. */
const addressLines = z.union([z.string(), z.array(z.string())]).optional()
    .describe('optional address, either one line of text or an array of lines, set it blank to reset it');
const toAddressLines = (value) => {
    if (value === undefined)
        return undefined;
    return Array.isArray(value) ? value : value.split('\n');
};
const mailingDetails = z.object({
    name: z.string().optional().describe('business name for mailing details, set it undefined to keep it unchanged, set it blank to reset it to Not Applicable'),
    country: z.string().describe('country for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
    state: z.string().describe('state for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
    address: addressLines,
    // a blank pincode is the documented way to clear it, so the pattern has to accept one
    pincode: z.string().regex(/^(\d{6})?$/).optional().describe('pincode for mailing details, 6 digits, set it blank to reset it, set it undefined to keep it unchanged'),
});
const contactDetails = z.object({
    contactPerson: z.string().optional().describe('name of the contact person, set it blank to reset it'),
    phone: z.string().optional().describe('landline or phone number, set it blank to reset it'),
    mobile: z.string().optional().describe('mobile number, set it blank to reset it'),
    email: z.string().optional().describe('email address, set it blank to reset it'),
    website: z.string().optional().describe('website, set it blank to reset it'),
});
const bankDetails = z.object({
    accountHolderName: z.string().optional().describe('name the bank account is held in'),
    accountNumber: z.string().optional().describe('bank account number'),
    ifscCode: z.string().optional().describe('IFSC code of the branch, 11 characters for an Indian bank'),
    swiftCode: z.string().optional().describe('SWIFT code of the bank, for an international transfer'),
    bankName: z.string().optional().describe('name of the bank'),
    branchName: z.string().optional().describe('name of the branch'),
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
    contactDetails: contactDetails.optional().describe('optional contact details for the ledger'),
    bankDetails: bankDetails.optional().describe('optional bank account details, applicable to a ledger under the Bank Accounts or Bank OD group'),
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
        payload.mailingDetails = {
            ...master.mailingDetails,
            address: toAddressLines(master.mailingDetails.address),
            applicableFrom: booksBeginFrom,
        };
    if (master.contactDetails)
        payload.contactDetails = master.contactDetails;
    if (master.bankDetails)
        payload.bankDetails = master.bankDetails;
    if (master.gstRegistrationDetails)
        payload.gstRegistrationDetails = { ...master.gstRegistrationDetails, applicableFrom: booksBeginFrom };
    if (master.isBillWise !== undefined)
        payload.isBillWise = master.isBillWise;
    if (master.isBillWise === true && typeof master.billCreditPeriod === 'number')
        payload.billCreditPeriod = Math.trunc(master.billCreditPeriod);
    return payload;
}
/** Company row used for the dates a ledger master needs, or an error result explaining why there is none. */
async function resolveCompany(name) {
    const companies = await queryCollection('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map());
    if (companies.length === 0)
        return { error: fail('No company found to determine books begin from date') };
    const company = name
        ? companies.find((item) => item.Name === name)
        : companies.find((item) => item.IsActiveCompany);
    if (!company)
        return {
            error: fail(name
                ? `No company found with the name ${name}. Kindly validate it using list-master tool with collection as company`
                : 'No active company found in Tally. Kindly open a company or pass targetCompany'),
        };
    return { company };
}
/** Sends one master import and returns Tally's counters. */
async function pushMasters(template, masters, company) {
    const input = new Map();
    input.set('masters', masters);
    if (company)
        input.set('targetCompany', company);
    return ok(await importMasters(template, input));
}
/** The name shape every simple master shares: a name, and an old name when renaming. */
const namedMaster = {
    name: z.string().min(1).describe('name, or the new name when renaming an existing object'),
    _name: z.string().optional().describe('old name of the object to modify, validate it using list-master tool'),
    parent: z.string().optional().describe('parent group name, validate it using list-master tool'),
};
export const writeTools = ({ server }) => {
    server.registerTool('ledger-create-update', {
        title: 'Create or Update Ledger',
        description: 'create or update ledger master data in Tally Prime, returns success count of created and / or altered records. a property left undefined keeps its current value in Tally, so a partial update is safe. read the result back with the query-collection tool on the ledger collection to confirm the fields Tally stored',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(ledgerMaster).describe('array of master data objects to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => {
        if (!Array.isArray(args.masters) || args.masters.length === 0)
            return fail('masters array is required with at least one master object to create or update');
        const resolved = await resolveCompany(args.targetCompany);
        if ('error' in resolved)
            return resolved.error;
        return pushMasters('master-ledger', args.masters.map((master) => toLedgerPayload(master, resolved.company.BooksFrom)), args.targetCompany);
    }));
    server.registerTool('group-create-update', {
        title: 'Create or Update Group',
        description: 'create or update accounting group master data in Tally Prime, returns success count of created and / or altered records',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(z.object({
                ...namedMaster,
                parent: z.string().optional().describe('parent group name, validate it using list-master tool with collection as group'),
                isBillWise: z.boolean().optional().describe('optional billwise or bill by bill tracking for ledgers of this group'),
                isCostCentresOn: z.boolean().optional().describe('optional cost centre tracking for ledgers of this group'),
            })).min(1).describe('array of groups to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => pushMasters('master-group', args.masters, args.targetCompany)));
    server.registerTool('stock-group-create-update', {
        title: 'Create or Update Stock Group',
        description: 'create or update stock group master data in Tally Prime, returns success count of created and / or altered records',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(z.object({
                ...namedMaster,
                parent: z.string().optional().describe('parent stock group name, validate it using list-master tool with collection as stockgroup'),
                isAddable: z.boolean().optional().describe('optional, true if quantities of the items of this group can be added together'),
            })).min(1).describe('array of stock groups to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => pushMasters('master-stock-group', args.masters, args.targetCompany)));
    server.registerTool('unit-create-update', {
        title: 'Create or Update Unit',
        description: 'create or update unit of measurement master data in Tally Prime, returns success count of created and / or altered records. a simple unit carries a symbol and a formal name, a compound unit is built from two existing simple units and a conversion',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(z.object({
                name: z.string().min(1).describe('symbol of the unit such as Nos, Kg or Ltr, or the full name of a compound unit'),
                _name: z.string().optional().describe('old name of the unit to modify, validate it using list-master tool with collection as unit'),
                formalName: z.string().optional().describe('full name such as Numbers or Kilogram, applicable to a simple unit'),
                decimalPlaces: z.number().int().min(0).max(4).optional().describe('optional number of decimal places, default 0'),
                baseUnit: z.string().optional().describe('base unit of a compound unit, validate it using list-master tool with collection as unit. supplying it makes the unit compound'),
                additionalUnit: z.string().optional().describe('additional unit of a compound unit, validate it using list-master tool with collection as unit'),
                conversion: z.number().positive().optional().describe('how many base units one additional unit holds, for example 12 for 1 Dozen = 12 Nos'),
            })).min(1).describe('array of units to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const incomplete = args.masters.filter((master) => master.baseUnit && !(master.additionalUnit && master.conversion));
        if (incomplete.length > 0)
            return fail(`A compound unit needs baseUnit, additionalUnit and conversion together. Incomplete: ${incomplete.map((m) => m.name).join(', ')}`);
        return pushMasters('master-unit', args.masters, args.targetCompany);
    }));
    server.registerTool('godown-create-update', {
        title: 'Create or Update Godown',
        description: 'create or update godown or warehouse or location master data in Tally Prime, returns success count of created and / or altered records',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(z.object({
                ...namedMaster,
                parent: z.string().optional().describe('parent godown name, validate it using list-master tool with collection as godown'),
                address: addressLines,
            })).min(1).describe('array of godowns to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => pushMasters('master-godown', args.masters.map((master) => ({ ...master, address: toAddressLines(master.address) })), args.targetCompany)));
    server.registerTool('stock-item-create-update', {
        title: 'Create or Update Stock Item',
        description: 'create or update stock item or product master data in Tally Prime, returns success count of created and / or altered records. an opening balance needs the quantity together with a rate or a value',
        inputSchema: {
            targetCompany: targetCompany(),
            masters: z.array(z.object({
                ...namedMaster,
                parent: z.string().optional().describe('stock group name, validate it using list-master tool with collection as stockgroup'),
                category: z.string().optional().describe('stock category name, validate it using list-master tool with collection as stockcategory, set it blank to reset it to Not Applicable'),
                unit: z.string().optional().describe('base unit of measurement, validate it using list-master tool with collection as unit'),
                alternateUnit: z.string().optional().describe('optional alternate unit, validate it using list-master tool with collection as unit'),
                conversion: z.number().positive().optional().describe('how many base units one alternate unit holds, required with alternateUnit'),
                partNo: z.string().optional().describe('optional part number'),
                costingMethod: z.enum(['Avg. Cost', 'FIFO', 'LIFO Annual', 'LIFO Perpetual', 'Std. Cost', 'At Zero Cost', 'Monthly Avg. Cost', 'Last Purchase Cost']).optional().describe('optional method of valuation of stock'),
                openingQuantity: z.number().optional().describe('optional opening quantity as on the books begin date'),
                openingRate: z.number().optional().describe('optional opening rate per unit'),
                openingValue: z.number().optional().describe('optional opening value'),
                gstDetails: z.object({
                    hsnCode: z.string().optional().describe('HSN or SAC code'),
                    rate: z.number().min(0).max(100).optional().describe('total GST rate as a percentage. it is split evenly between CGST and SGST, and used whole for IGST. leave it out to inherit the rate from the company or stock group'),
                    taxability: z.enum(['Taxable', 'Exempt', 'Nil Rated']).optional().describe('optional GST taxability'),
                }).optional().describe('optional GST details'),
            })).min(1).describe('array of stock items to create or update'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const incomplete = args.masters.filter((master) => master.alternateUnit && !master.conversion);
        if (incomplete.length > 0)
            return fail(`An alternate unit needs a conversion. Incomplete: ${incomplete.map((m) => m.name).join(', ')}`);
        const resolved = await resolveCompany(args.targetCompany);
        if ('error' in resolved)
            return resolved.error;
        return pushMasters('master-stock-item', args.masters.map((master) => master.gstDetails
            ? { ...master, gstDetails: { ...master.gstDetails, applicableFrom: resolved.company.BooksFrom } }
            : master), args.targetCompany);
    }));
    server.registerTool('company-create', {
        title: 'Create Company',
        description: 'creates a new company in Tally Prime. this is not the same as the set-company tool, which only selects a company that already exists. the company is created in the data directory Tally is configured to use. Tally must accept company creation over the XML interface for this to work, so read the returned counters and confirm with the list-master tool using collection as company',
        inputSchema: {
            name: z.string().min(1).describe('name of the company to create'),
            booksFrom: isoDate().describe('date the books begin, normally the first day of a financial year'),
            country: z.string().describe('country, validate it using query-option-values tool with input optionName as country-state'),
            state: z.string().describe('state, validate it using query-option-values tool with input optionName as country-state'),
            mailingName: z.string().optional().describe('optional name used on printed documents, defaults to the company name'),
            address: addressLines,
            pincode: z.string().regex(/^(\d{6})?$/).optional().describe('optional pincode, 6 digits'),
            email: z.string().optional().describe('optional email address'),
            phoneNumber: z.string().optional().describe('optional phone number'),
            currencySymbol: z.string().optional().describe('optional base currency symbol, default is the rupee symbol'),
            currencyName: z.string().optional().describe('optional base currency name, default is Rupees'),
            isBillWise: z.boolean().optional().describe('optional bill by bill tracking, default true'),
            isInventory: z.boolean().optional().describe('optional inventory or stock maintenance, default true'),
            isCostCentres: z.boolean().optional().describe('optional cost centre tracking, default false'),
        },
        annotations: writes,
    }, guard(async (args) => {
        const existing = await queryCollection('Company', ['Name'], new Map());
        if (existing.some((item) => item.Name === args.name))
            return fail(`A company named ${args.name} already exists`);
        const input = new Map();
        input.set('masters', [{
                name: args.name,
                booksFrom: new Date(args.booksFrom),
                country: args.country,
                state: args.state,
                mailingName: args.mailingName,
                address: toAddressLines(args.address),
                pincode: args.pincode,
                email: args.email,
                phoneNumber: args.phoneNumber,
                currencySymbol: args.currencySymbol ?? '₹',
                currencyName: args.currencyName ?? 'Rupees',
                isBillWise: args.isBillWise !== false,
                isInventory: args.isInventory !== false,
                isCostCentres: args.isCostCentres === true,
            }]);
        return ok(await importMasters('company', input));
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
        // a voucher is identified by its guid, not by a name, so it needs its own tool
        if (collection === 'Voucher')
            return fail('Use the voucher-cancel-delete tool to remove a voucher. A voucher has no name, it is identified by its guid');
        // checked first so a typo does not reach Tally as a delete
        const existing = await queryCollection(collection, ['Name'], new Map(), args.targetCompany);
        const missing = args.name.filter((name) => !existing.some((item) => item.Name === name));
        if (missing.length > 0)
            return fail(`No master object found with the given name(s) in the ${collection} collection: ${missing.join(', ')}. Kindly validate it using list-master tool`);
        return ok(await deleteMasters(collection, args.name, args.targetCompany));
    }));
};
//# sourceMappingURL=write.mjs.map