/**
 * Reading Tally collections (masters and their computed balances).
 */

import * as m from '../models.mjs';
import { utility } from '../utility.mjs';
import { lstCollectionFields } from '../definition.mjs';
import { sendTallyXml } from './client.mjs';
import { parseRows } from './parse.mjs';

export function collectionDefinition(collection: string): m.TallyCollectionDefinition {
    const definition = lstCollectionFields.find((c) => c.collection === collection);
    if (!definition)
        throw new Error(`Unknown collection [${collection}]`);
    return definition;
}

/** Renames keys of every object in an array, leaving unmapped keys untouched. */
export function renameObjectArrayProperties(source: any[], keyMap: Map<string, string>): any[] {
    if (!Array.isArray(source) || source.length === 0)
        return [];

    if (!(keyMap instanceof Map) || keyMap.size === 0)
        return source.slice();

    return source.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return item;

        const renamed: Record<string, any> = {};
        for (const [key, value] of Object.entries(item))
            renamed[keyMap.get(key) ?? key] = value;

        return renamed;
    });
}

export async function queryCollection(
    targetCollection: string,
    lstFields: string[],
    lstFilters: Map<string, string>,
    targetCompany?: string,
    fromDate?: Date,
    toDate?: Date
): Promise<any[]> {
    const definition = collectionDefinition(targetCollection);
    const queryFields = definition.fields.filter((f) => lstFields.includes(f.name));

    const args = new Map<string, any>();
    if (targetCompany) args.set('targetCompany', targetCompany);
    if (fromDate) args.set('fromDate', fromDate);
    if (toDate) args.set('toDate', toDate);
    args.set('collection', targetCollection);
    args.set('fields', queryFields);

    if (lstFilters && lstFilters.size > 0)
        args.set('filters', [...lstFilters].map(([name, expression]): m.TallyFilterDefinition => ({ name, expression })));

    const rows = parseRows(await sendTallyXml('generic/query-collection', args));

    return rows.map((row) => {
        const item: Record<string, any> = {};
        for (const field of queryFields) {
            // a tag Tally omits must not throw, so it is read as empty
            const raw = (row[field.name.toUpperCase()] ?? '').toString();
            item[field.name] = convertField(raw, field.datatype);
        }
        return item;
    });
}

function convertField(raw: string, datatype: string): number | string | boolean | Date | null {
    if (datatype === 'boolean')
        return raw === 'Yes';
    if (datatype === 'number' || datatype === 'amount' || datatype === 'quantity' || datatype === 'rate')
        return parseFloat(raw);
    if (datatype === 'date')
        return utility.Date.parse(raw, 'yyyy-MM-dd');
    return utility.String.unescapeHTML(raw);
}
