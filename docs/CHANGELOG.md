# Release History

### Unreleased

Security (remote HTTP deployment only, the Claude Desktop extension is not affected):
* `GET /mcp` and `DELETE /mcp` required no authentication. Anyone who could name a session id could open its notification stream or end it. Every method on `/mcp` now needs a valid bearer token
* A session is now owned by the OAuth client that opened it. Any valid token could previously drive any session
* `/token` parsed the client secret from the Basic authentication header and then discarded it without checking. It is verified now, in constant time
* The refresh token returned was a copy of the access token, and `refresh_token` was not an accepted grant, so a client had to re-enter the password every hour. Refresh tokens are now separate, rotate on use, expire, and are bound to the client they were issued to
* DNS rebinding protection was configured but never switched on, and the value passed was a URL where a host name was expected. It is enabled, and accepts `MCP_DOMAIN`, the loopback names, and anything in the new `ALLOWED_HOSTS`
* The password was compared with `==`, which is not constant time, and there was no limit on attempts. It is compared in constant time and limited per address, tunable with `AUTH_ATTEMPT_LIMIT` and `AUTH_ATTEMPT_WINDOW_MS`
* `POST /authorize` accepted any `client_id` and any `redirect_uri`. Both are validated, as they already were on `GET /authorize`
* `/register` accepted any string as a `redirect_uri`, including `javascript:`. Only absolute http and https URLs without a fragment are accepted, and the client table is bounded by `MAX_REGISTERED_CLIENTS`
* `.env` was committed with `PASSWORD=password`, so every clone shipped a known password. It is removed from the repository and ignored, `.env.example` replaces it, and the server refuses to start on a non-local `MCP_DOMAIN` while the password is still the default. Set `ALLOW_DEFAULT_PASSWORD=1` to override
* Authorization codes, tokens and attempt counters now expire and are swept

Added:
* GitHub Actions CI, running the type check, the build, a check that the committed `dist/` and manifest are current, the tests on Node 24 (the active LTS), and a guard against committing `.env`

Changed:
* Internal restructuring, with no change to the tool surface. The XML templates are now compiled from `templates/**/*.njk` instead of being kept a second time as minified strings, the tool definitions are split into modules under `src/tools/`, the Tally access code is split under `src/tally/`, and the `tools` list in `manifest.json` is generated from the registered tools
* Every MCP session now gets its own in-memory result cache. It used to be one shared instance, so in the web-server setup one client could read another client's cached tables through *query-database*
* A double quote in a name given to *trial-balance* or *stock-summary* is now removed rather than doubled, which is what *list-master* already did. TDL cannot escape a quote inside a string literal, so doubling it produced an expression Tally could not parse
* Requests to Tally now time out, controlled by the optional `TALLY_TIMEOUT` environment variable, instead of waiting forever
* Added a test suite, run with `pnpm test`

Fixed:
* `templates/push/master-ledger.njk` was missing an `{% endif %}` and did not compile. Nothing loaded it, so the fault went unnoticed while the working copy of the same template lived in the source as a minified string

### Version: v7.6 [04-Sep-2026]
Fixed:
* Tool *ledger-account* with instance where the target ledger being queried is used multiple times in a single voucher was not being aggregated leading to incorret data being returned as reporting in [#28](https://github.com/dhananjay1405/tally-mcp-server/issues/28) is now fixed

### Version: v7.5 [10-Aug-2026]

Added:
* Add many fields into collection definition to make query-collection even more robust
* Introduced feature of blocking access to Write functionality tool as discussed in [#26](https://github.com/dhananjay1405/tally-mcp-server/issues/26) by introduction of environment variable BLOCK_WRITE
* MCP was unable to connect to tally running of PC other than local, as localhost was hard-coded in Tally Host setting. Based on suggestion for improvement in [#25](https://github.com/dhananjay1405/tally-mcp-server/issues/25) environment variable TALLY_HOST was introduced to allow setting of IP address to connect Tally running on different computer

Fixed:
* House-keeping task like upgrading of depedencies (node packages)
* Improvement in the documentation

### Version: v7.4 [03-Jul-2026]

Added:
* Tool delete-master introduce to delete master type collection [#14](https://github.com/dhananjay1405/tally-mcp-server/issues/14)

Fixed:
* Date was being shifted by 1 day due to UTC offset. Fixed applied addressing issue [#23](https://github.com/dhananjay1405/tally-mcp-server/issues/23)

### Version: v7.3 [31-May-2026]

Fixed:
* Tool query-collection was crashing Tally instance when the all of the fields requested did not exists in Tally, due to which bad Tally XML request was being generated, which is fixed in https://github.com/dhananjay1405/tally-mcp-server/pull/20

### Version: v7.2 [13-May-2026]

Added:
* Bundled version of Tally MCP Server for Claude Desktop i.e. Extension, for one-click installation

### Version: v7.1 [13-May-2026]

Fixed:
* Internal TDL syntax in XML request were breaking when double quote was specified in input for tools, which is now escaped properly
* Faulty handling for 0 and blank string is fixed
* In v7 tool chart-of-accounts was modified to extract only group, due to which response cycle was getting longer consuming more tokens. This behavious is reverted back to orginal
* In tool **ledger-account** field displaying alternate ledger is introduced, since party name field is found empty for journal type vouchers

### Version: v7 [12-May-2026]

Added:
* Tools **set-period** and **set-company** which can act as extra safeguard if user wants to set it as default for subsequent tool calls
* Tool **query-collection** to quickly query various fields of collection dynamically for ad-hoc information gathering [#11](https://github.com/dhananjay1405/tally-mcp-server/issues/11)
* Tools **metadata-collection** and **metadata-fields** to be used as helper functionality to gather listing of available collections and their fields for *query-collection* tool
* Tool **query-option-values** to gather listing of drop-down values from Tally for various data-entry screens [#12](https://github.com/dhananjay1405/tally-mcp-server/issues/12)
* Tool **ledger-create-update** to create or update ledger(s) on-the-fly in Tally [#7](https://github.com/dhananjay1405/tally-mcp-server/issues/7)

Fixed:
* Database of in-memory query was changed from **DuckDB** to **PgLite** for better cross-platform experience. Justification behind this change was increasing adoption of this MCP server in Mac OS [[#10](https://github.com/dhananjay1405/tally-mcp-server/issues/10)]
* Migrated many reports to use tool query-collection internally to reduce static XML templates. As a result many of XML template files are now removed in favour of internal tool call. Reports are left only for few tools which have complex TDL expression which is difficult to accommodate in query collection functionality.
* Tool usage for reports were found to be reading template file from disk for every tool call. Caching of these templates was implemented by storing minified XML of these template in key-value variables [#13](https://github.com/dhananjay1405/tally-mcp-server/issues/13)
* TSV (Tab Separated Value) format was facing issue for few AI agents, which are designed to work only with JSON output. TSV has been removed in favour of introduction of 4 output format CSV, Markdown, JSON Array of Objects, JSON Schema and Rows

### Version: v6 [11-Nov-2025]

Added:
* Introducing of DuckDB based in-memory database caching of tabular output into temporary table (which persists for 15 min), for quick and accurate aggregation, filtering, sorting, calculation (which LLM is not capable of). This feature helps to do away with context size limitation of LLM for MCP output, which often produced error or hallucination. LLM now smartly handles by using SQL query to get this done.

Fixed:
* Renaming of column names for better readability and SQL querying by MCP
* Fixed few prompt description
* Amount was coming as 0 for *ledger-account* tool for few scenario, is now fixed by relevant XML TDL expression changes
* Quantity fetched by *stock-item-balance* tool was in absolute number ignoring negative balance scenario, is fixed by applying changes to XML
* Debit / Credit total in *trial-balance* tool was suppose to be positive for net Debit or net Credit respetively, is now fixed by applying changes on XML

### Version: v5 [06-Nov-2025]

Added:
* Stock Item Account tool

Fixed:
* ledger-account tool was ignoring Debit / Credit sign for opening balance. XML was fixed to prefix Dr / Cr sign


### Version: v4 [30-Oct-2025]

Added:
* Ease of configuration of setting via **.env** file instead of environment variables
* Balance Sheet and Profit Loss tools

Fixed:
* Ability to fetch from specific targetCompany was not working, which is now fixed
* ledger-account tool was skipping vouchers for some scenario. XML was fixed to query it and optimize it further as per Tally Solution TDL blog for best practise
* Unnecessary XML files used during initial development phase were removed


### Version: v3 [09-Oct-2025]

Added:
* Tool **chart-of-accounts** to grab group hierarchy structure
* Tool **stock-summary** to pull summary of all stock items with opening / inward / outward / closing values of quantity and amount

Fixed:
* Revamped MCP code to enhance connectivity with ChatGPT
* Minor fixes in Tally XML handling
* Tool **ledger-account** was skipping opening balance, which is not added into it
* Converted output of all the possible tools to tab separated format for optimization and light-weight response


### Version: v2 [04-Oct-2025]

Added:
* Tool **ledger-account** to grab ledger account
* Support for **ChatGPT** platform remote MCP

Fixed:
* oAuth implementation was revamped to adhere better to specification 2.1. These fixes allowed ChatGPT connectivity.
* Tabular response format was changed from JSON (which is heavy) to tab-separated for optimization. This allowed fitting of more data in response context.
* CLIENT_SECRET term was mistakenly used in entire code base, which was renamed as PASSWORD which is precise description of it.


### Version: v1 [02-Sep-2025]

Added:
* Entire implementation of Local &amp; Remote MCP