/** Generic access: raw SQL over cached tables, and arbitrary collection queries. */

import { z } from 'zod';
import { queryCollection, collectionDefinition } from '../tally/index.mjs';
import type { OutputFormat } from '../database.mjs';
import { cachedTable, collectionNames, fail, guard, okText, readOnly, targetCompany, type ToolModule } from './shared.mjs';

/** Cache column type for a collection field. */
const cacheType = (datatype: string): string => {
    if (['amount', 'quantity', 'rate', 'number'].includes(datatype)) return 'number';
    if (datatype === 'date' || datatype === 'boolean') return datatype;
    return 'string';
};

export const queryTools: ToolModule = ({ server, cache }) => {

    server.registerTool('query-database', {
        title: 'Query Database',
        description: 'executes sql query on pglite postgres in-memory database for querying cached Tally Prime report data in table generated as output by other tools (in tableID property from tool output response). These tables are temporary and will be dropped after 15 minutes automatically. Use this tool to run complex analytical queries to aggregate, filter, sort results',
        inputSchema: {
            sql: z.string().describe('SQL query to execute on pglite postgres in-memory database, only SELECT queries are allowed. UPDATE, DELETE, INSERT queries are not allowed for data safety'),
            outputFormat: z.enum(['JSON Array of Objects', 'JSON with Schema and Rows', 'CSV', 'Markdown Table']).optional()
                .describe('optional output format, default is JSON Array of Objects. JSON Array of Objects = [{"column1": "value1", "column2": "value2"}, {...}] , JSON with Schema and Rows = {"schema": ["column1", "column2"], "rows": [["value1", "value2"], [...]]}, CSV = comma separated values with header, Markdown Table = table format with header in markdown syntax which can be directly rendered in markdown supported viewers'),
        },
        annotations: readOnly,
        // guarded like every other tool, so a syntax error or a table that has
        // expired comes back as an error result and not as a transport failure
    }, guard(async (args) => okText(await cache.executeSQL(args.sql, (args.outputFormat as OutputFormat) ?? 'JSON Array of Objects'))));

    server.registerTool('query-collection', {
        title: 'Query Collection',
        description: 'queries a Tally Prime collection with selected fields and optional context like target company and reporting period. result is cached in pglite postgres in-memory table and returned as tableID. Use query-database tool to run SQL queries against that table for further analysis',
        inputSchema: {
            collection: z.enum(collectionNames).describe('collection name to query, validate it using metadata-collection tool with exact collection name'),
            fields: z.array(z.string()).min(1).describe('list of field names to fetch for the selected collection. validate it using metadata-fields resource for that collection'),
            targetCompany: targetCompany(),
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional from date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional to date'),
        },
        annotations: readOnly,
    }, guard(async (args) => {
        const collection = args.collection.trim();
        const requested = args.fields.map((field) => field.trim());
        const available = collectionDefinition(collection).fields;

        const invalid = requested.filter((f) => !available.some((a) => a.name === f));
        if (invalid.length > 0)
            return fail(`The following fields do not exist in collection '${collection}': ${invalid.join(', ')}. Use metadata-fields resource to get valid field names.`);

        const rows = await queryCollection(
            collection, requested, new Map(), args.targetCompany,
            args.fromDate ? new Date(args.fromDate) : undefined,
            args.toDate ? new Date(args.toDate) : undefined);

        const columns = new Map(available
            .filter((field) => requested.includes(field.name))
            .map((field) => [field.name, cacheType(field.datatype)] as [string, string]));

        return cachedTable(cache, columns, rows,
            { company: args.targetCompany, fromDate: args.fromDate, toDate: args.toDate });
    }));
};
