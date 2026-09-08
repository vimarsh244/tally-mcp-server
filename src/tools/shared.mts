/**
 * Shared building blocks for the tool definitions.
 *
 * Twelve tools followed the same shape: run a collection query, rename the
 * columns, cache the rows, return the table id, and turn any throw into an
 * error result. That body is written once here.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResultCache } from '../database.mjs';
import { lstCollectionFields } from '../definition.mjs';

export type ToolResult = {
    isError?: boolean;
    content: { type: 'text'; text: string }[];
};

/** Context handed to every tool module. */
export interface ToolContext {
    server: McpServer;
    cache: ResultCache;
}

export type ToolModule = (context: ToolContext) => void;

export const collectionNames = lstCollectionFields.map((item) => item.collection) as [string, ...string[]];

/**
 * JSON.stringify() on an Error yields '{}', which loses the message, so every
 * error is reduced to text explicitly.
 */
export function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return JSON.stringify(err) ?? 'Unknown error';
}

/** Returns a JSON encoded payload, which is what every tool but query-database emits. */
export const ok = (payload: unknown): ToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
});

/** Returns text verbatim, for results that are already formatted (CSV, Markdown, SQL JSON). */
export const okText = (text: string): ToolResult => ({
    content: [{ type: 'text', text }],
});

export const fail = (message: string): ToolResult => ({
    isError: true,
    content: [{ type: 'text', text: message }],
});

/** Wraps a handler so a throw becomes an error result rather than a transport failure. */
export function guard<A>(handler: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
    return async (args: A) => {
        try {
            return await handler(args);
        } catch (err) {
            return fail(toErrorMessage(err));
        }
    };
}

// input fragments repeated across most tools
export const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const targetCompany = () => z.string().optional()
    .describe('optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified');

export const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
export const writes = { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true } as const;
export const changesContext = { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true } as const;

/** Column name to cache type, in the order the columns should appear. */
export type ColumnMap = Map<string, string>;

/** Caches rows and returns the standard `{ tableID }` payload. */
export async function cachedTable(cache: ResultCache, columns: ColumnMap, rows: any[]): Promise<ToolResult> {
    return ok({ tableID: await cache.cacheTable(columns, rows) });
}

/**
 * Caches rows and returns the table id together with extra payload fields,
 * for a tool that also has to report a row count or a paging position.
 */
export async function cachedTableWith(cache: ResultCache, columns: ColumnMap, rows: any[], extra: Record<string, unknown>): Promise<ToolResult> {
    return ok({ tableID: await cache.cacheTable(columns, rows), ...extra });
}

/** Builds a column map from pairs, keeping the call sites readable. */
export const columns = (...pairs: [string, string][]): ColumnMap => new Map(pairs);
