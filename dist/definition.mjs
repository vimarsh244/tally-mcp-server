/**
 * Collection, field and report definitions.
 *
 * The Tally XML lives in templates/**\/*.njk and is compiled into
 * templates.generated.mts, so this file holds data only.
 */
export const lstOptionCountryState = [
    {
        country: 'India',
        state: ['Andaman & Nicobar', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']
    },
    {
        country: 'UAE',
        state: ['Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras al-Khaimah', 'Sharjah', 'Umm al-Quwain']
    },
    {
        country: 'UK',
        state: ['England', 'Scotland', 'Wales', 'Northern Ireland']
    },
    {
        country: 'USA',
        state: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming']
    },
    {
        country: 'Saudi Arabia',
        state: ['Riyadh', 'Makkah', 'Madina', 'Eastern Province', 'Asir', 'Tabuk', 'Hail', 'Northern Borders', 'Jizan', 'Najran', 'Al-Baha', 'Al-Jouf']
    },
    {
        country: 'Qatar',
        state: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Al Khor', 'Al Shamal', 'Al Daayen', 'Umm Salal', 'Ash Shihaniyah']
    },
    {
        country: 'Kuwait',
        state: ['Al Asimah', 'Hawalli', 'Al Ahmadi', 'Al Farwaniyah', 'Al Jahra']
    },
    {
        country: 'Tanzania',
        state: ['Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pemba North', 'Pemba South', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Tabora', 'Tanga']
    },
    {
        country: 'Nigeria',
        state: ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara']
    }
];
export const lstCollectionFields = [
    {
        collection: 'Company',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Address', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
            { name: 'StateName', datatype: 'string' },
            { name: 'CountryName', datatype: 'string' },
            { name: 'Pincode', datatype: 'string', description: 'postal code or ZIP code of the company' },
            { name: 'PhoneNumber', datatype: 'string', description: 'contact or mobile number' },
            { name: 'Email', datatype: 'string' },
            { name: 'BooksFrom', datatype: 'date', description: 'financial year start date when the books keeping started or the company was split' },
            { name: 'IsActiveCompany', datatype: 'boolean', expression: '$$IsEqual:$Name:##SVCurrentCompany', description: 'true if the company is active and currently selected in Tally, false if the company is inactive or not currently selected in Tally' }
        ]
    },
    {
        collection: 'VoucherType',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'AffectsStock', datatype: 'boolean' },
        ]
    },
    {
        collection: 'Group',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
            { name: 'IsRevenue', datatype: 'boolean', description: 'true if the group belongs to profit loss, false if group belongs to balance sheet' },
            { name: 'IsDeemedPositive', datatype: 'boolean', description: 'true if group nature is debit, false if group nature is credit' },
            { name: 'AffectsGrossProfit', datatype: 'boolean', description: 'applicable only when isRevenue is true, if found true then group belongs to trading used for gross profit calculation' },
            { name: 'SortPosition', datatype: 'number' },
            { name: 'OpeningBalance', datatype: 'amount', description: 'opening or starting or begning balance of group based on from date' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or ending balance of group based on to date' }
        ]
    },
    {
        collection: 'Ledger',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "Reserves & Surplus" else $Parent', description: 'group under which ledger is nested' },
            { name: '_PrimaryGroup', datatype: 'string', description: 'primary group of parent or group, under which ledger is nested' },
            { name: 'IsRevenue', datatype: 'boolean', description: 'true if the group belongs to profit loss, false if group belongs to balance sheet' },
            { name: 'IsDeemedPositive', datatype: 'boolean', description: 'true if group nature is debit, false if group nature is credit' },
            { name: 'AffectsGrossProfit', datatype: 'boolean', description: 'applicable only when isRevenue is true, if found true then group belongs to trading used for gross profit calculation' },
            { name: 'OpeningBalance', datatype: 'amount', description: 'opening or starting or begning balance based on from date' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or ending or balance based on to date' },
            { name: 'DebitTotals', datatype: 'amount', description: 'total debit amount of all vouchers passed during the period from and to date, negative denotes debit and vice-a-versa' },
            { name: 'CreditTotals', datatype: 'amount', description: 'total credit amount of all vouchers passed during the period from and to date, positive denotes credit and vice-a-versa' },
            { name: 'MailingName', datatype: 'string', description: 'name of the ledger for mailing or correspondence purpose' },
            { name: 'MailingAddress', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address', description: 'address of the ledger for mailing or correspondence purpose' },
            { name: 'LedStateName', datatype: 'string', description: 'state of the ledger for mailing or correspondence purpose' },
            { name: 'CountryName', datatype: 'string', description: 'country of the ledger for mailing or correspondence purpose' },
            { name: 'Pincode', datatype: 'string', description: 'postal code or ZIP code of the ledger for mailing or correspondence purpose' },
            { name: 'Email', datatype: 'string', description: 'email address of the ledger for mailing or correspondence purpose' },
            { name: 'MobileNumber', datatype: 'string', expression: 'if NOT $$IsEmpty:$LedgerMobile then $$Sprintf:"%s %s":$LedgerCountryISDCode:$LedgerMobile else ""', description: 'mobile number of the ledger for mailing or correspondence purpose' },
            { name: 'GSTN', datatype: 'string', expression: 'if $$IsEmpty:$PartyGSTIN then $LedGSTRegDetails[Last].GSTIN else $PartyGSTIN', description: 'GST number of the party ledger' },
            { name: 'GSTRegType', datatype: 'string', expression: 'if $$IsEmpty:$Gstregistrationtype then $LedGSTRegDetails[Last].Gstregistrationtype else $Gstregistrationtype', description: 'GST registration type of the party ledger' },
            { name: 'GstTypeOfsupply', datatype: 'string', description: 'GST type of supply of the party ledger' },
            { name: 'GstDutyHead', datatype: 'string', description: 'GST duty head of the party ledger' }
        ]
    },
    {
        collection: 'Unit',
        description: 'Unit of measurement used for stock items',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'FormalName', datatype: 'string', description: 'full name or formal name like Kilogram for name as kg, Litre for name as ltr, Piece for name as pcs' },
            { name: 'BaseUnits', datatype: 'string', description: 'base units' },
            { name: 'AdditionalUnits', datatype: 'string', description: 'additional units if any' },
            { name: 'Conversion', datatype: 'string', description: 'conversion expression or multiplier to convert additional units to base units if applicable, example "1 Dozen = 12 Pcs" or "1 Quintal = 100 Kgs"' }
        ]
    },
    {
        collection: 'Godown',
        description: 'warehouse or location of stock items',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string' },
            { name: 'Address', datatype: 'string', expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
        ]
    },
    {
        collection: 'StockGroup',
        description: 'group of stock item',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' }
        ]
    },
    {
        collection: 'StockCategory',
        description: 'category of stock item',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' }
        ]
    },
    {
        collection: 'StockItem',
        description: 'stock item or product or service constituting inventory or services purchased or sold',
        fields: [
            { name: 'Name', datatype: 'string' },
            { name: 'Parent', datatype: 'string', expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent', description: 'name field of StockGroup collection under which item is nested' },
            { name: 'Category', datatype: 'string', description: 'name field of StockCategory collection under which item is nested if applicable' },
            { name: 'OnlyAlias', datatype: 'string', description: 'alternate name or alias' },
            { name: 'PartNo', datatype: 'string', expression: 'if $$IsEqual:$BaseUnits:$$SysName:NotApplicable then "" else $BaseUnits', description: 'part number, or classification' },
            { name: 'Unit', datatype: 'string', expression: 'if $$IsEqual:$BaseUnits:$$SysName:NotApplicable then "" else $BaseUnits', description: 'name field of Unit collection under which item is nested' },
            { name: 'AlternateUnit', datatype: 'string', expression: 'if $$IsEqual:$AdditionalUnits:$$SysName:NotApplicable then "" else $AdditionalUnits', description: 'name field of Unit collection under which item is nested which is set as alternate or additional unit' },
            { name: 'Conversion', datatype: 'number', description: 'multiplier for alternate or additional unit' },
            { name: 'OpeningBalance', datatype: 'quantity', description: 'opening or begning quantity as on from date' },
            { name: 'ClosingBalance', datatype: 'quantity', description: 'closing or ending or balance quantity left as on to date' },
            { name: 'OpeningValue', datatype: 'amount', description: 'opening or begning value of stock item as on from date, negative denotes debit and to be treated as positive and vice-a-versa' },
            { name: 'ClosingValue', datatype: 'amount', description: 'closing or ending value of stock item as on to date, negative denotes debit and to be treated as positive and vice-a-versa' },
            { name: 'OpeningRate', datatype: 'rate', description: 'opening or begning rate as on from date' },
            { name: 'ClosingRate', datatype: 'rate', description: 'closing or ending rate as on to date' },
            { name: 'CostingMethod', datatype: 'string', description: 'method of valuation of opening or closing stock which can be Avg. Cost (Average Cost), FIFO (First in First Out), Std. Cost (Standard Cost), At Zero Cost, Monthly Avg. Cost' },
            { name: 'InwardQuantity', datatype: 'quantity', description: 'total inward quantity purchase or sales return or stock transfer during the period from and to date' },
            { name: 'OutwardQuantity', datatype: 'quantity', description: 'total outward quantity sales or purchase return or stock transfer during the period from and to date, it will be in negative which denotes outflow to be treated as positive and vice-a-versa' },
            { name: 'InwardValue', datatype: 'amount', description: 'total inward value of purchase or sales return or stock transfer during the period from and to date, negative denotes debit and positive credit' },
            { name: 'OutwardValue', datatype: 'amount', description: 'total outward value of sales or purchase return or stock transfer during the period from and to date, positive denotes credit and negative debit' },
            { name: 'CostingMethod', datatype: 'string', description: 'method of valuation of stock which can be Avg. Cost (Average Cost), FIFO (First in First Out), Std. Cost (Standard Cost), At Zero Cost, Monthly Avg. Cost' },
            { name: 'GSTMSTTypeofSupply', datatype: 'string', description: 'GST type of supply' },
            { name: 'InfGSTHSNCode', datatype: 'string', description: 'GST HSN code' },
            { name: 'InfGSTHSNDescription', datatype: 'string', description: 'GST HSN description' },
            { name: 'InfGSTIGSTRate', datatype: 'number', description: 'GST IGST rate' },
            { name: 'InfGSTTaxablility', datatype: 'string', description: 'GST taxability' }
        ]
    },
    {
        collection: 'Bill',
        description: 'Bill references for outstanding payables or receivables',
        fields: [
            { name: 'BillDate', datatype: 'date' },
            { name: 'Name', datatype: 'string', description: 'bill number or reference number' },
            { name: 'ClosingBalance', datatype: 'amount', description: 'closing or outstanding balance of bill as on to date, negative denotes debit and positive credit' },
            { name: 'Parent', datatype: 'string', description: 'name field of Ledger collection, party debtor or creditor under which bill is nested' },
            { name: '_OverDueDays', datatype: 'number', description: 'over due days, number of days bill is overdue as on to date' }
        ]
    }
];
export const lstReportConfig = [
    {
        name: 'ledger-account',
        input: [
            { name: 'fromDate', datatype: 'date' },
            { name: 'toDate', datatype: 'date' },
            { name: 'ledgerName', datatype: 'string' }
        ],
        output: [
            { name: 'guid', datatype: 'string' },
            { name: 'date', datatype: 'date' },
            { name: 'voucher_type', datatype: 'string' },
            { name: 'voucher_number', datatype: 'string' },
            { name: 'alternate_ledger', datatype: 'string' },
            { name: 'party_ledger', datatype: 'string' },
            { name: 'amount', datatype: 'number' },
            { name: 'narration', datatype: 'string' }
        ]
    },
    {
        name: 'stock-item-account',
        input: [
            { name: 'fromDate', datatype: 'date' },
            { name: 'toDate', datatype: 'date' },
            { name: 'itemName', datatype: 'string' }
        ],
        output: [
            { name: 'date', datatype: 'date' },
            { name: 'voucher_type', datatype: 'string' },
            { name: 'voucher_number', datatype: 'string' },
            { name: 'party_ledger', datatype: 'string' },
            { name: 'quantity', datatype: 'number' },
            { name: 'amount', datatype: 'number' },
            { name: 'narration', datatype: 'string' },
            { name: 'tracking_number', datatype: 'string' },
            { name: 'voucher_category', datatype: 'string' }
        ]
    }
];
//# sourceMappingURL=definition.mjs.map