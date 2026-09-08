# Tally Prime MCP Server

fork of: dhananjay1405/tally-mcp-server

Tally Prime MCP (Model Context Protocol) Server implementation to feed Tally Prime ERP data to popular LLM like Claude, ChatGPT supporting MCP client. This MCP Server helps expose functionalities of Tally to LLM directly.


## Prerequisites
* Tally Prime (Silver / Gold)
* Node JS

Ensure below things are pre-installed and setup:
* Ensure to [download & install Node JS](https://nodejs.org/en) from official website
* XML Port of Tally Prime must be enabled (F1 &gt; Settings &gt; Connectivity &gt; Client/Server configuration) with below settings
```
TallyPrime acts as = Server
Port = 9000
```

*Note: Kindly avoid using Educational version of Tally Prime, which has limitations of date range. It will result in invalid / partial data being fed to LLM, leading to highly degraded &amp; incorrect responses.*

## Download
Avoid cloning repository directly. Utility is available for download (with required dependencies) on below link <br>
[https://excelkida.com/resource/tally-mcp-server-v7.6.zip](https://excelkida.com/resource/tally-mcp-server-v7.6.zip)

One-click installer **extension** for **Claude Desktop**<br>
[https://excelkida.com/resource/tally-mcp-server-v7.6.mcpb](https://excelkida.com/resource/tally-mcp-server-v7.6.mcpb)

Last updated: version **7.6** [04-Sep-2026]

Refer docs/CHANGELOG.md for details

## Build from source
This project uses **pnpm** as package manager. It is needed only if you clone the repository and build the code yourself. Users of the zip file or the extension can skip this section.

Install pnpm (Node JS 22 or higher is required)
```bash
npm install -g pnpm
```
Corepack is an alternative, which ships with Node JS
```bash
corepack enable pnpm
```

Install the dependencies and build the project
```bash
pnpm install
pnpm build
```

The compiled files are written to the **dist** folder. Start the web-server version with
```bash
pnpm start
```

Run the tests
```bash
pnpm test
```

Check the build without writing anything, which is what CI should run
```bash
pnpm check
```

### What `pnpm build` does
`pnpm build` runs three steps in order.

|Step|Command|Purpose|
|--|--|--|
|1|`pnpm build:templates`|Compiles `templates/**/*.njk` into `src/templates.generated.mts`|
|2|`tsc`|Compiles `src` into `dist`|
|3|`pnpm build:manifest`|Rewrites the `tools` list and `version` in `manifest.json` from the registered tools|

`node scripts/bench-cache-insert.mjs` is separate from the build. It measures how
long the result cache takes to store a report, one row at a time against in
batches, on rows held in memory. It needs no Tally.

Both generated outputs are committed, so a plain `tsc` still works. Do not edit
`src/templates.generated.mts` or the `tools` array in `manifest.json` by hand.
Change the `.njk` file or the tool definition and run `pnpm build`.

### Project layout

|Path|Contents|
|--|--|
|`src/tools/`|One module per group of MCP tools, plus the shared helpers|
|`src/tally/`|Talking to Tally: the HTTP client, collection queries, reports and master writes|
|`src/http/`|The HTTP transport: OAuth, the MCP endpoint, realms and the setup API|
|`src/profiles.mts`|The profile registry, for several Tally users on one machine|
|`src/tally-target.mts`|Which Tally instance the current request talks to|
|`src/templates.mts`|Loads and renders the compiled XML templates|
|`src/escape.mts`|The escaping rules for TDL expressions and SQL identifiers|
|`src/definition.mts`|Collection, field and report definitions, data only|
|`templates/`|The Tally XML templates, authored as readable nunjucks files|
|`scripts/`|The two build steps described above|
|`windows/`|The Windows service packaging: staging script, service definition, installer|
|`tests/`|Tests, run with `pnpm test`|

## Supported Platform
Implementation was tested on below AI platform

|Platform|Local|Remote|
|--|--|--|
|Claude AI| :heavy_check_mark: | :heavy_check_mark: |
|ChatGPT|| :heavy_check_mark: |
|Grok|| :heavy_check_mark: |


## Setup (Local)
This mode of setup is to be used when MCP Client (like Claude Desktop, Perplexity etc.) and Tally Prime both exists in local PC. MCP Client software itself runs the MCP Server internally in such scenario.

Simply download &amp; extract zip file somewhere on the disk.  Assuming that we downloaded &amp; extracted zip file on below path (folder)
```
D:\Software\Tally MCP Server
```

<image src="https://excelkida.com/image/github/explorer-tally-mcp-server.png" height="265" width="766" />

A sample setup for few popular tools is demonstrated.

### Claude Desktop
Desktop version of Claude AI supports loading of local MCP server. Ensure you have Pro / Team / Max / Enterprise subscription of Claude, which supports higher limit compared to Free. MCP makes multiple calls to Tally for validation and inference, which might exhaust free limits quickly. Download Claude Desktop from following link
[claude.ai/download](https://claude.ai/download)

#### One-click installation (via Extension)

Go to menu &gt; File &gt; Settings

<image src="https://excelkida.com/image/github/claude-desktop-settings-menu.png" height="185" width="335">

Extensions &gt; Advance Settings

<image src="https://excelkida.com/image/github/claude-desktop-settings-extension.png" height="553" width="928">

Click on install extension button

<image src="https://excelkida.com/image/github/claude-desktop-extension-page.png" height="619" width="868">

Browse the extension file (with file extension mcpb) download at the start

<image src="https://excelkida.com/image/github/claude-desktop-extension-install.png" height="843" width="696">

A dialog window will appear asking *Do you want to install Tally Prime?* click **Install** button, which would install the Tally MCP Server

#### Installation via Config file (via Developer menu)

Go to menu &gt; File &gt; Settings &gt; Developer

<image src="https://excelkida.com/image/github/claude-desktop-developer-setting.png" height="751" width="1045" />

This will open My Computer window. Right click and edit **claude_desktop_config.json** file (via Notepad) with as below JSON
```json
{
  "mcpServers": {
	  "Tally Prime": {
		  "command": "node",
		  "args": ["D:\\Software\\Tally MCP Server\\dist\\index.mjs"]
	  }
  }
}
```
*Note: single slash in folder path needs to be substituted with double slash*

Save the file. Close Claude Desktop (menu &gt; File &gt; Exit) and again re-launch it.

Verify by clicking on Tools button and check if Tally Prime appears in the list (screenshot below)

<image src="https://excelkida.com/image/github/claude-desktop-tally-mcp-server-tool-display.png" height="595" width="722" />

### Perplexity Desktop
Perplexity Desktop version for MacOS supports connecting to local MCP server. Configuration file (JSON format) is same as demonstrated for Claude Desktop. In absense of MacBook, documentation with screenshot could not be written. Kindly refer to below blog on perplexity website, which explains the steps.

[Perplexity Desktop MCP Connectivity](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity)

## Setup (Cloud)
This mode of setup is to be used, when using browser-based MCP client like ChatGPT, Claude AI, Copilot, OR mobile-based app for these LLM which cannot access Tally Prime running inside local PC. In this scenario, MCP Server needs to run as web-server, internally connected to Tally securely. Setup is quite complicated, and is covered in detail in **docs** folder of this project.
* [Linux-based Server](docs/server-setup-linux.md)
* Windows Server (exploration in-progress)

## Available Tools

This server currently exposes 30 MCP tools.

### What a reporting tool returns

Every tool that caches a result answers with the same envelope.

|Property|Meaning|
|--|--|
|`tableID`|Name of the in-memory table holding the rows, for the *query-database* tool. Empty when there are no rows|
|`rowCount`|Number of rows in the result. `0` with no error means the report ran and matched nothing|
|`columns`|Column names, in order|
|`company`|The company the result is of, when one was named|
|`period`|`{ fromDate, toDate }`, when the tool takes a period|
|`generatedAt`|When the result was read from Tally, as an ISO timestamp|
|`expiresAt`|When the cached table is dropped|
|`rows`|The rows themselves, present only when the result is small enough to carry (25 rows and 4 KB by default). It is every row or none, never a part, so a second call is needed only for a large result|

A tool that fails returns the reason as an error. A request Tally refused is an
error, not an empty result.

### metadata-collection
Returns metadata for supported collections.

**Input**
No input.

**Output**
JSON array with objects containing:
1. `collection`
1. `description`

### query-option-values
Returns predefined option values used by input fields.

**Input**
|Argument|Description|
|--|--|
|optionName|Supported: `country-state`|

**Output**
JSON array of option values for the selected option name.

### metadata-fields
Returns field metadata for a selected collection.

**Input**
|Argument|Description|
|--|--|
|collection|Collection name. Use `metadata-collection` to discover valid values|

**Output**
JSON array of field metadata containing field name, description (if any), and normalized datatype (`string`, `number`, `date`, `boolean`).

### query-database
Runs SQL query on in-memory pglite tables previously created by reporting tools.

**Input**
|Argument|Description|
|--|--|
|sql|SELECT query only|
|outputFormat|One of `JSON Array of Objects`, `JSON with Schema and Rows`, `CSV`, `Markdown Table`. Default is JSON Array of Objects which is preferred format|

**Output**
Query result in tab-separated text format.

### query-collection
Queries a Tally collection for selected fields and caches output in an in-memory table.

**Input**
|Argument|Description|
|--|--|
|collection|Collection name|
|fields|Array of field names to fetch|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate (optional)|Date in YYYY-MM-DD|
|toDate (optional)|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "..." }`

### list-master
Fetches list of masters for validation and auto-completion.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|collection|One of: `group`, `ledger`, `vouchertype`, `unit`, `godown`, `stockgroup`, `stockitem`, `costcategory`, `costcentre`, `attendancetype`, `company`, `currency`, `gstin`, `gstclassification`|
|containsFilter (optional)|filter to apply CONTAINS operation to restrict values|

**Output**
JSON: `{ "list": [ ... ] }`

### chart-of-accounts
Extracts Chart of Accounts (or Group hierarchy) useful for preparing Balance Sheet, Profit and Loss, Trial Balance

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `ledger_name`
1. `group_name`
1. `primary_group`
1. `bs_pl` (boolean) [**true** = Profit &amp; Loss  / **false** = Balance Sheet]
1. `dr_cr` (boolean) [**true** = Debit / **false** = Credit]
1. `affects_gross_profit` (boolean) [**true** = Affects Gross Profit / **false** = Does not affect Gross Profit]
1. `sort_position` (number)

### trial-balance
Fetches trial balance for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|group_name (optional)|Filter by group name|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `ledger_name`
1. `group_name`
1. `opening_balance` (number) [**negative** = Debit / **positive** = Credit]
1. `net_debit`
1. `net_credit`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### profit-loss
Fetches profit and loss data for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `ledger_name`
1. `group_name`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### balance-sheet
Fetches balance sheet data for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `ledger_name`
1. `group_name`
1. `closing_balance` (number) [**negative** = Debit / **positive** = Credit]

### stock-summary
Fetches stock item summary for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|stockGroup (optional)|Filter by stock group name|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `stock_item_name`
1. `stock_group_name`
1. `opening_quantity` (number)
1. `opening_value` (number) [**negative** = Debit / **positive** = Credit]
1. `inward_quantity` (number)
1. `inward_value` (number)
1. `outward_quantity` (number)
1. `outward_value` (number)
1. `closing_quantity` (number)
1. `closing_value` (number) [**negative** = Debit / **positive** = Credit]

### ledger-balance
Returns ledger closing balance as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|ledgerName|Exact ledger name|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "amount": number }` where negative = Debit and positive = Credit.

### stock-item-balance
Returns stock item closing quantity as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|itemName|Exact stock item name|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "quantity": number, "unit_of_measurement": string }` when found.

### bills-outstanding
Fetches receivable/payable bill-wise outstanding as on date.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|nature|`receivable` or `payable`|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `bill_date`
1. `reference_number`
1. `outstanding_amount`
1. `party_name`
1. `overdue_days`

### ledger-account
Fetches ledger account statement for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|ledgerName|Ledger name|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|includeNarration (optional)|Default `true`. Set `false` on a long history to have Tally leave the narration out of the export. The `narration` column is then empty|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `guid`
1. `date`
1. `voucher_type`
1. `voucher_number`
1. `alternate_ledger`
1. `party_name`
1. `amount` (number) [**negative** = Debit / **positive** = Credit]
1. `narration`

### stock-item-account
Fetches stock item account statement for period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|itemName|Stock item name|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|

**Output**
JSON: `{ "tableID": "..." }` with columns:
1. `date`
1. `voucher_type`
1. `voucher_number`
1. `party_ledger`
1. `quantity`
1. `amount` (number) [**negative** = Debit / **positive** = Credit]
1. `narration`
1. `tracking_number`
1. `voucher_category`

### daybook
Fetches the daybook, one row per voucher entered in the period.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|fromDate|Date in YYYY-MM-DD|
|toDate|Date in YYYY-MM-DD|
|voucherType (optional)|Exact voucher type name to filter on|
|partyLedgerName (optional)|Exact party ledger name to filter on|
|includeCancelled (optional)|Default `false`|
|includeOptional (optional)|Default `false`|
|includeNarration (optional)|Default `true`. Set `false` on a long period to have Tally leave the narration out of the export|
|limit (optional)|Page size, default and maximum 1000|
|offset (optional)|Rows to skip, default 0|

**Output**
JSON: `{ "tableID": "...", "rowCount": n, "totalRowCount": n, "hasMore": bool, "nextOffset": n }` with columns:
1. `guid` (pass this to *voucher-get*)
1. `date`
1. `voucher_type`
1. `voucher_number`
1. `reference`
1. `party_name`
1. `amount` (number) [total debit value of the voucher, always positive]
1. `narration`
1. `is_cancelled`
1. `is_optional`

### voucher-get
Fetches one complete voucher, with every ledger line, bill reference and inventory line. A ledger statement shows only the part of a voucher that touches that one ledger, this tool shows the whole transaction.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|voucherGuid|`guid` returned by *daybook* or *ledger-account*|
|date|Date of the voucher in YYYY-MM-DD|
|includeBills (optional)|Default `true`|
|includeInventory (optional)|Default `true`|

**Output**
JSON returned inline, not as a cached table:
1. `voucher` - the header, same fields as one *daybook* row
1. `ledger_entries` - `ledger_name`, `amount` [**negative** = Debit / **positive** = Credit], `is_debit`, `cost_centre`
1. `bill_allocations` - `ledger_name`, `bill_name`, `bill_type`, `amount`
1. `inventory_entries` - `stock_item_name`, `quantity`, `rate`, `amount`, `godown_name`, `tracking_number`

### ledger-create-update
Creates or updates one or more ledger.

**Note: This tool has ability to modify existing ledger. Always backup your Company before instructing this tool.**

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of ledger master objects to create/update|

Master ledger object accepts following

|Property|Description|
|--|--|
|name|Ledger name or New Ledger name (during update)|
|_name|Existing ledger name|
|parent|Group under which ledger would exists|
|openingBalance|(optional) Opening Balance of the Ledger|
|isBillWise|(optional) flag to set Bill-by-Bill referencing|
|billCreditPeriod|(optional) Credit Period for bill in days|
|mailingDetails|(optional) Business Name for mailing purpose, country, state, pincode, address|
|contactDetails|(optional) contact person, phone, mobile, email, website|
|bankDetails|(optional) account holder name, account number, IFSC code, SWIFT code, bank name, branch name. Applicable to a ledger under the Bank Accounts or Bank OD group|
|gstRegistrationDetails|(optional) GST registration details like GST Number, Registration Type, Place of Supply (state)|

**Output**
JSON result returned by import operation (success/failure details).

### voucher-create-update
Creates new transactions, or replaces existing ones.

**Note: This tool has ability to modify existing vouchers. Always backup your Company before instructing this tool.**

Every ledger, voucher type and stock item named is validated first, and every amount of a voucher must add up to zero. If any voucher of the batch fails validation, nothing is sent to Tally at all.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|vouchers|Array of voucher objects to create or alter|
|verify (optional)|Default `true`. Reads the affected dates back from the daybook after the import|

Voucher object accepts following

|Property|Description|
|--|--|
|action|(optional) `create` (default) or `alter`. An alter replaces the whole voucher, so send every line again|
|guid|Voucher guid, required when action is `alter`|
|voucherType|Voucher type name such as Payment, Receipt, Contra, Journal, Sales, Purchase|
|date|Date in YYYY-MM-DD|
|effectiveDate|(optional) Defaults to the voucher date|
|voucherNumber|(optional) Leave it out to let Tally number the voucher|
|reference / referenceDate|(optional) Supplier invoice number and its date|
|partyLedgerName|(optional) Party ledger of the voucher|
|narration|(optional) Notes or remarks|
|isInvoice|(optional) Default `false`. Set `true` for a sales or purchase in invoice mode|
|entries|Ledger lines: `ledgerName`, `amount` [**negative** = Debit / **positive** = Credit], optional `billAllocations` and `costCentreAllocations`|
|inventoryEntries|(optional) Stock lines: `stockItemName`, `quantity` (always positive), `rate`, `amount`, optional `unit`, `godownName`, `batchName`, `ledgerName`|

**Output**
JSON counters returned by the import, plus `verified`, the vouchers found again in the daybook.

### voucher-cancel-delete
Cancels or deletes existing transactions. A cancelled voucher keeps its number and stays visible with no entries, a deleted voucher is removed.

**Note: This cannot be undone. Always backup your Company before instructing this tool.**

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|mode|`cancel` or `delete`|
|vouchers|Array of `{ guid, date }`. Every guid is looked up in the daybook first|

**Output**
JSON result returned by the import operation.

### group-create-update
Creates or updates accounting groups.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of `{ name, _name, parent, isBillWise, isCostCentresOn }`|

**Output**
JSON result returned by the import operation.

### stock-group-create-update
Creates or updates stock groups.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of `{ name, _name, parent, isAddable }`|

**Output**
JSON result returned by the import operation.

### unit-create-update
Creates or updates units of measurement. A simple unit carries a symbol and a formal name, a compound unit needs `baseUnit`, `additionalUnit` and `conversion` together.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of `{ name, _name, formalName, decimalPlaces, baseUnit, additionalUnit, conversion }`|

**Output**
JSON result returned by the import operation.

### godown-create-update
Creates or updates godowns, warehouses or locations.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of `{ name, _name, parent, address }`|

**Output**
JSON result returned by the import operation.

### stock-item-create-update
Creates or updates stock items or products.

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|masters|Array of stock item objects|

Stock item object accepts following

|Property|Description|
|--|--|
|name / _name|Item name, and the existing name when renaming|
|parent|Stock group|
|category|(optional) Stock category, blank resets it to Not Applicable|
|unit / alternateUnit / conversion|(optional) Units of measurement. An alternate unit needs a conversion|
|partNo|(optional) Part number|
|costingMethod|(optional) `Avg. Cost`, `FIFO`, `Std. Cost` and the other Tally methods|
|openingQuantity / openingRate / openingValue|(optional) Opening stock as on the books begin date|
|gstDetails|(optional) `hsnCode`, `rate` (split evenly between CGST and SGST, used whole for IGST), `taxability`|

**Output**
JSON result returned by the import operation.

### company-create
Creates a new company. This is not the same as *set-company*, which only selects a company that already exists.

**Note: Tally must accept company creation over the XML interface. Read the returned counters and confirm with *list-master*.**

**Input**
|Argument|Description|
|--|--|
|name|Company name|
|booksFrom|Date the books begin, in YYYY-MM-DD|
|country / state|Validate with *query-option-values*|
|mailingName, address, pincode, email, phoneNumber|(optional)|
|currencySymbol / currencyName|(optional) Default is the rupee symbol and Rupees|
|isBillWise / isInventory / isCostCentres|(optional) Defaults are `true`, `true` and `false`|

**Output**
JSON result returned by the import operation.

### delete-master
Delete one (or more) masters from Tally

**Input**
|Argument|Description|
|--|--|
|targetCompany (optional)|Company name (defaults to active company)|
|collection|Type of master or collection to delete. One of: `group`, `ledger`, `vouchertype`, `unit`, `godown`, `stockgroup`, `stockitem`, `costcategory`, `costcentre`, `attendancetype`, `company`, `currency`, `gstin`, `gstclassification` |
|name|array of name(s) of master to be deleted|

A voucher has no name, it is identified by its guid, so use *voucher-cancel-delete* for one.

**Output**
JSON result returned by delete operation (count of deleted, skipped, etc).

### set-company
Sets active company context in Tally Prime.

**Input**
|Argument|Description|
|--|--|
|companyName|Company name to activate|

**Output**
JSON string: `"OK"` on success.

### set-period
Sets active reporting period context in Tally Prime.

**Input**
|Argument|Description|
|--|--|
|fromDate|Start date in YYYY-MM-DD|
|toDate|End date in YYYY-MM-DD|

**Output**
JSON string: `"OK"` on success.

## Environment Variables

End-users are free to hard-code few settings which needs to be applied

|Variable|Description|
|--|--|
|TALLY_PORT|Port Number of XML Server of Tally (*optional*, default is **9000**)|
|TALLY_HOST|Host name or IP where XML Server is running (*optional*, default is **localhost**)|
|TALLY_TIMEOUT|Milliseconds to wait for a reply from Tally before giving up (*optional*, default is **120000**, i.e. 2 minutes)|
|CACHE_TABLE_TTL_MS|Milliseconds a cached result table survives before it is dropped (*optional*, default is **900000**, i.e. 15 minutes)|
|TALLY_MAX_CONCURRENT|Requests allowed against one Tally at a time, per host and port (optional, default **4**). Tally builds one report at a time, so a higher number mostly moves the queue into Tally. Set **0** to remove the limit|
|CACHE_INSERT_BATCH_ROWS|Rows sent to the in-memory database in one INSERT (optional, default **500**). Held below the 32767 bind parameters a statement may carry, whatever is set here|
|INLINE_ROW_LIMIT|A result of this many rows or fewer is also returned inline under `rows`, so reading it needs no second call (optional, default **25**). Set **0** to always answer with the table id alone|
|INLINE_BYTE_LIMIT|Upper bound in bytes on an inline result, so a few long narrations cannot make a large response (optional, default **4096**)|
|TRACE|Set to **1** to emit one structured timing record per tool call on stderr: queue wait, wait for Tally's first byte, the whole Tally request with byte counts, the cache insert with its row count, and the SQL. Stage names, durations and sizes only (optional, default **0**)|
|BLOCK_WRITE|Controls if MCP completely block access of write functionality. Setting this flag to value **1** will completely hide write functionality tools from the tool list. [ **0 = Allow , 1 = Block** ] (optional, default is **0** i.e. allowed). Not applicable for Claude Desktop (as it offers graphical switch to disable write functionality)|
|PORT|Tally MCP Server port number. Applicable only if Tally Prime MCP Server is deployed as Remote MCP server (*optional*, default is **3000**). Not applicable for Claude Desktop|
|MCP_DOMAIN|Domain name of Tally MCP Server website (*optional*, default is https://localhost:9000). Not applicable for Claude Desktop|
|PASSWORD|Password for the OAuth Login front-end page to authenticate genuine user. The server **refuses to start** on a non-local `MCP_DOMAIN` while this is left at the default of **password**. Not applicable for Claude Desktop|
|ALLOW_DEFAULT_PASSWORD|Set to **1** to start on a public domain with the default password anyway (*optional*, default is **0**). Only for a deployment you know is otherwise protected|
|ALLOWED_HOSTS|Extra `Host` header values the `/mcp` endpoint accepts, comma separated. The value of `MCP_DOMAIN` and the loopback names are always accepted (*optional*)|
|TRUST_PROXY|Set to **1** when running behind a reverse proxy, so the attempt limiter sees the real client address from `X-Forwarded-For` (*optional*, default is **0**)|
|ACCESS_TOKEN_TTL_MS|Lifetime of an issued access token (*optional*, default is **3600000**, i.e. 1 hour)|
|REFRESH_TOKEN_TTL_MS|Lifetime of an issued refresh token (*optional*, default is **2592000000**, i.e. 30 days)|
|MAX_REGISTERED_CLIENTS|Upper bound on dynamically registered OAuth clients (*optional*, default is **100**)|
|AUTH_ATTEMPT_LIMIT|Failed password attempts allowed per address per window (*optional*, default is **10**)|
|AUTH_ATTEMPT_WINDOW_MS|Length of that window (*optional*, default is **900000**, i.e. 15 minutes)|
|BIND_HOST|Address the HTTP server binds to. Set **127.0.0.1** to accept connections from this machine only (*optional*, default is **0.0.0.0**, i.e. every interface)|
|MULTI_USER|Set to **1** to serve one profile per Tally user at `/u/<id>/mcp`. Each profile has its own Tally port, password and token, and the unprefixed routes are switched off (*optional*, default is **0**)|
|TALLY_MCP_DATA_DIR|Where the profile registry and the admin token are kept. Applies only when `MULTI_USER=1` (*optional*, defaults to `%ProgramData%\TallyMcpServer` on Windows and `~/.tally-mcp-server` elsewhere)|

## Several Tally users on one machine

A Windows Server runs one copy of Tally per signed in person, and each copy needs
its own XML port. `MULTI_USER=1` turns on the profile registry so one server
process can serve all of them:

* each profile is reachable at `/u/<id>/mcp` and talks only to its own Tally port
* each profile has its own consent password and its own bearer token
* a token issued for one profile is refused on every other profile
* the write tools can be hidden per profile
* a setup page at `/admin`, reachable from the machine itself and guarded by an
  admin token, finds the running copies of Tally and makes the profiles

The packaged Windows service does all of this. See
[docs/server-setup-windows.md](docs/server-setup-windows.md) to install it, and
[windows/README.md](windows/README.md) to build the setup EXE.

## Security of the remote deployment

This applies only to the remote (HTTP) setup. The Claude Desktop extension runs
over stdio and is not affected.

Copy `.env.example` to `.env` and set a real `PASSWORD`. **`.env` is ignored by
git and must never be committed.** The server refuses to start on a non-local
`MCP_DOMAIN` while the password is still the default.

Access control works as follows.

* Every request to `/mcp` needs a bearer token, including `GET` (the
  notification stream) and `DELETE` (ending a session).
* A session belongs to the OAuth client that opened it. A token issued to one
  client cannot read or end another client's session.
* The `Host` header must match `MCP_DOMAIN`, a loopback name, or an entry in
  `ALLOWED_HOSTS`. This blocks DNS rebinding.
* Tokens are checked for expiry, refresh tokens rotate on use and are bound to
  the client they were issued to, and an authorization code can be spent once.
* Repeated wrong passwords from one address are refused for a while.

Run the server behind TLS. Tokens and the password are sent in plain text over
a plain HTTP connection.

## Contact
Project developed & maintained by: **Dhananjay Gokhale**

Email: **info@excelkida.com** <br>
Whatsapp: **(+91) 90284-63366**