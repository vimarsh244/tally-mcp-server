/**
 * Shared building blocks for the tool definitions.
 *
 * Twelve tools followed the same shape: run a collection query, rename the
 * columns, cache the rows, return the table id, and turn any throw into an
 * error result. That body is written once here.
 */
import { z } from 'zod';
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
/** Caches rows and returns the standard `{ tableID }` payload. */
export async function cachedTable(cache, columns, rows) {
    return ok({ tableID: await cache.cacheTable(columns, rows) });
}
/** Builds a column map from pairs, keeping the call sites readable. */
export const columns = (...pairs) => new Map(pairs);
//# sourceMappingURL=shared.mjs.map