/**
 * Shared building blocks for the tool definitions.
 *
 * Twelve tools followed the same shape: run a collection query, rename the
 * columns, cache the rows, return the table id, and turn any throw into an
 * error result. That body is written once here.
 */
import { z } from 'zod';
import { displayRows } from '../database.mjs';
import { config } from '../config.mjs';
import { lstCollectionFields } from '../definition.mjs';
export const collectionNames = lstCollectionFields.map((item) => item.collection);
/**
 * JSON.stringify() on an Error yields '{}', which loses the message, so every
 * error is reduced to text explicitly.
 */
export function toErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'string')
        return err;
    return JSON.stringify(err) ?? 'Unknown error';
}
/** Returns a JSON encoded payload, which is what every tool but query-database emits. */
export const ok = (payload) => ({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
});
/** Returns text verbatim, for results that are already formatted (CSV, Markdown, SQL JSON). */
export const okText = (text) => ({
    content: [{ type: 'text', text }],
});
export const fail = (message) => ({
    isError: true,
    content: [{ type: 'text', text: message }],
});
/** Wraps a handler so a throw becomes an error result rather than a transport failure. */
export function guard(handler) {
    return async (args) => {
        try {
            return await handler(args);
        }
        catch (err) {
            return fail(toErrorMessage(err));
        }
    };
}
// input fragments repeated across most tools
export const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const targetCompany = () => z.string().optional()
    .describe('optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified');
export const readOnly = { readOnlyHint: true, openWorldHint: false };
export const writes = { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true };
export const changesContext = { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true };
/**
 * Caches rows and returns the result envelope.
 *
 * An empty result used to be an empty table id and nothing else, so a caller
 * had to guess whether the report had failed or was simply empty. rowCount
 * says which, and the company and the period say what the numbers are of.
 *
 * A small result is also returned inline under `rows`, in exactly the form
 * query-database would give for the same table, so reading three rows does not
 * need a second round trip. `rows` is either every row or absent, never a part.
 */
export async function cachedTable(cache, columns, rows, meta = {}, extra = {}) {
    const tableID = await cache.cacheTable(columns, rows);
    const payload = {
        tableID,
        rowCount: rows.length,
        columns: [...columns.keys()],
    };
    if (meta.company)
        payload.company = meta.company;
    if (meta.fromDate)
        payload.period = { fromDate: meta.fromDate, toDate: meta.toDate };
    payload.generatedAt = new Date().toISOString();
    if (tableID)
        payload.expiresAt = new Date(Date.now() + config.cacheTableTtlMs).toISOString();
    const inline = inlineRows(columns, rows);
    if (inline)
        payload.rows = inline;
    return ok({ ...payload, ...extra });
}
/** Returns every row when the result is small enough to carry, otherwise nothing. */
function inlineRows(columns, rows) {
    if (config.inlineRowLimit <= 0 || rows.length === 0 || rows.length > config.inlineRowLimit)
        return undefined;
    const shaped = displayRows(columns, rows);
    // a narration or an address can be long, so the row count alone is not a bound
    if (JSON.stringify(shaped).length > config.inlineByteLimit)
        return undefined;
    return shaped;
}
/** Builds a column map from pairs, keeping the call sites readable. */
export const columns = (...pairs) => new Map(pairs);
//# sourceMappingURL=shared.mjs.map