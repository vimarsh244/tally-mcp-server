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
        await this.pg.exec(`CREATE TABLE ${tableId} (${columnSql});`);
        const insertSql = `INSERT INTO ${tableId} (${columns.map(([name]) => sqlIdentifier(name)).join(', ')})`
            + ` VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`;
        await this.pg.transaction(async (tx) => {
            for (const row of data)
                await tx.query(insertSql, columns.map(([name, type]) => toColumnValue(row[name], type)));
        });
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
        const result = await this.pg.query(statement, [], { rowMode: 'array' });
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
    /** Drops every pending table timer. Used when a session ends. */
    close() {
        for (const timer of this.timers)
            clearTimeout(timer);
        this.timers.clear();
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