/**
 * In-memory PGlite cache for tool results.
 *
 * Each MCP session gets its own store. It used to be one module level
 * singleton, so in HTTP mode every client shared one table namespace and any
 * client could read another client's cached data through query-database.
 */
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { utility } from './utility.mjs';
import { config } from './config.mjs';
import { sqlIdentifier } from './escape.mjs';
import { record } from './trace.mjs';
/**
 * Bind parameters one statement may carry.
 *
 * The wire protocol counts them in a signed 16 bit field, so 32767 is the
 * ceiling. Going over it does not raise an error: PGlite answers that statement,
 * and every later query on the same connection, with an empty result. A wrong
 * answer with no error is worse than a failure, so the batch size is held below
 * this whatever CACHE_INSERT_BATCH_ROWS says.
 */
const MAX_BIND_PARAMETERS = 32767;
const PG_DATE_OID = 1082;
const PG_NUMERIC_OID = 1700;
const NUMERIC_TYPES = ['number', 'amount', 'quantity', 'rate'];
const sqlTypeFor = (colType) => {
    if (NUMERIC_TYPES.includes(colType))
        return 'NUMERIC(18,4)';
    if (colType === 'boolean')
        return 'BOOLEAN';
    if (colType === 'date')
        return 'DATE';
    return 'TEXT';
};
const toColumnValue = (value, colType) => {
    if (NUMERIC_TYPES.includes(colType)) {
        // isNaN(null) is false, so a null must be rejected before the numeric conversion
        if (value === null || value === undefined || value === '')
            return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    if (colType === 'boolean')
        return typeof value === 'boolean' ? value : null;
    if (colType === 'date')
        return value instanceof Date ? utility.Date.format(value, 'yyyy-MM-dd') : null;
    return value || '';
};
/**
 * The rows exactly as they land in the cached table, so a result returned
 * inline and the same result read back through SQL cannot disagree.
 */
export function displayRows(lstColumnMetadata, data) {
    return data.map((row) => {
        const item = {};
        for (const [name, type] of lstColumnMetadata)
            item[name] = toColumnValue(row[name], type);
        return item;
    });
}
const escapeCsv = (value) => /[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const escapeMarkdown = (value) => value.replace(/\|/g, '\\|');
const cellToText = (value) => value === null ? '' : value.toString();
export class ResultCache {
    pg;
    timers = new Set();
    closed = false;
    constructor(pg) {
        this.pg = pg;
    }
    static async create() {
        return new ResultCache(await PGlite.create('memory://'));
    }
    /**
     * Stores rows in a fresh table and returns its id. An empty result yields an
     * empty id, which callers pass straight back to the model.
     */
    async cacheTable(lstColumnMetadata, data) {
        if (!data || data.length === 0)
            return '';
        const tableId = 't_' + crypto.randomUUID().replace(/-/g, '');
        const columns = [...lstColumnMetadata];
        const columnSql = columns.map(([name, type]) => `${sqlIdentifier(name)} ${sqlTypeFor(type)}`).join(', ');
        const columnList = columns.map(([name]) => sqlIdentifier(name)).join(', ');
        // one statement per row cost a round trip per row, which was the whole
        // of the insert time on a long statement. The rows go in batches now,
        // bounded by the row count asked for and by the parameter limit
        const rowsPerBatch = Math.max(1, Math.min(config.cacheInsertBatchRows, Math.floor(MAX_BIND_PARAMETERS / Math.max(columns.length, 1))));
        const started = process.hrtime.bigint();
        let batches = 0;
        // the table is created inside the transaction too, so a batch that fails
        // leaves nothing behind at all rather than an empty table
        await this.pg.transaction(async (tx) => {
            // query, not exec: exec uses the simple protocol, which can commit
            // the surrounding transaction out from under the inserts
            await tx.query(`CREATE TABLE ${tableId} (${columnSql})`);
            for (let start = 0; start < data.length; start += rowsPerBatch) {
                const values = [];
                const tuples = data.slice(start, start + rowsPerBatch).map((row) => {
                    const placeholders = columns.map(([name, type]) => {
                        values.push(toColumnValue(row[name], type));
                        return `$${values.length}`;
                    });
                    return `(${placeholders.join(', ')})`;
                });
                await tx.query(`INSERT INTO ${tableId} (${columnList}) VALUES ${tuples.join(', ')}`, values);
                batches++;
            }
        });
        record('cache.insert', Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3, { rows: data.length, columns: columns.length, batches });
        // unref so a pending drop never holds the process open
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            void this.pg.exec(`DROP TABLE IF EXISTS ${tableId};`).catch(() => undefined);
        }, config.cacheTableTtlMs);
        timer.unref?.();
        this.timers.add(timer);
        return tableId;
    }
    async executeSQL(sql, format = 'JSON Array of Objects') {
        // Comments are stripped only to find the leading keyword. The stripped text is
        // what runs, so a trailing statement hidden behind a comment cannot slip through.
        const statement = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
        // WITH is deliberately not allowed: a data-modifying CTE such as
        // `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x` would pass a
        // check that only looked for a leading SELECT.
        if (!/^select\b/i.test(statement))
            throw new Error('Only SELECT queries are permitted');
        const started = process.hrtime.bigint();
        const result = await this.pg.query(statement, [], { rowMode: 'array' });
        record('cache.query', Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3, { rows: result.rows.length });
        const header = result.fields.map((f) => f.name);
        const types = result.fields.map((f) => f.dataTypeID);
        const rows = result.rows.map((row) => row.map((cell, c) => normalizeCell(cell, types[c])));
        if (format === 'CSV')
            return [header.map(escapeCsv).join(','), ...rows.map((r) => r.map((v) => escapeCsv(cellToText(v))).join(','))].join('\n');
        if (format === 'Markdown Table')
            return [
                '| ' + header.map(escapeMarkdown).join(' | ') + ' |',
                '| ' + header.map(() => '---').join(' | ') + ' |',
                ...rows.map((r) => '| ' + r.map((v) => escapeMarkdown(cellToText(v))).join(' | ') + ' |'),
            ].join('\n');
        if (format === 'JSON with Schema and Rows')
            return JSON.stringify({ schema: header, rows });
        return JSON.stringify(rows.map((row) => Object.fromEntries(header.map((name, c) => [name, row[c]]))));
    }
    /**
     * Releases the session's tables and the database behind them.
     *
     * Clearing the timers used to be all this did, so the PGlite instance and
     * every table in it stayed in memory for the life of the process, one per
     * session that had ever connected. Calling it twice is harmless.
     */
    close() {
        for (const timer of this.timers)
            clearTimeout(timer);
        this.timers.clear();
        if (this.closed)
            return;
        this.closed = true;
        void this.pg.close().catch(() => undefined);
    }
}
function normalizeCell(cellValue, dataTypeID) {
    if (cellValue === null || cellValue === undefined)
        return null;
    if (dataTypeID === PG_DATE_OID)
        return cellValue instanceof Date ? cellValue.toISOString().substring(0, 10) : cellValue.toString();
    if (dataTypeID === PG_NUMERIC_OID) {
        // strip trailing zeros, so '1.5000' reads as 1.5
        const num = parseFloat(cellValue.toString());
        if (!Number.isNaN(num))
            return num;
    }
    if (typeof cellValue === 'boolean')
        return cellValue;
    return cellValue.toString();
}
//# sourceMappingURL=database.mjs.map