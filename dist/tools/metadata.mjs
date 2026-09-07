/** Tools that describe the available collections, fields and option values. */
import { z } from 'zod';
import { lstCollectionFields, lstOptionCountryState } from '../definition.mjs';
import { collectionNames, fail, ok, readOnly } from './shared.mjs';
export const metadataTools = ({ server }) => {
    server.registerTool('metadata-collection', {
        title: 'Metadata Collection',
        description: 'returns collections metadata with collection and description',
        inputSchema: {},
        annotations: readOnly,
    }, async () => ok(lstCollectionFields.map(({ collection, description }) => ({ collection, description }))));
    server.registerTool('metadata-fields', {
        title: 'Metadata Fields',
        description: 'returns fields metadata for the selected tally collection containing field name, optional description and data type which can be string, number, date or boolean',
        inputSchema: {
            collection: z.enum(collectionNames).describe('target collection to fetch field metadata'),
        },
        annotations: readOnly,
    }, async (args) => {
        const fields = lstCollectionFields.find((item) => item.collection === args.collection)?.fields ?? [];
        return ok(fields.map(({ expression, ...field }) => ({
            ...field,
            // amount, quantity and rate are all numeric as far as the caller is concerned
            datatype: ['amount', 'quantity', 'rate'].includes(field.datatype) ? 'number' : field.datatype,
        })));
    });
    server.registerTool('query-option-values', {
        title: 'Query Option Values',
        description: 'returns predefined option values or drop-down values for the fields required for master and voucher creation, it returns back object array of pre-defined values',
        inputSchema: {
            optionName: z.enum(['country-state']).describe('option name to query'),
        },
        annotations: readOnly,
    }, async (args) => args.optionName === 'country-state'
        ? ok(lstOptionCountryState)
        : fail('Invalid option name'));
};
//# sourceMappingURL=metadata.mjs.map