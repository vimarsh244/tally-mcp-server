/**
 * Shared parsing of Tally XML responses and of the scalar formats Tally emits.
 */
import { XMLParser } from 'fast-xml-parser';
import { utility } from '../utility.mjs';
/** Tally repeats <ROW> and any *.LIST tag, so both must always be arrays. */
export const rowParser = new XMLParser({
    parseTagValue: false,
    isArray: (tagName) => tagName === 'ROW' || tagName.endsWith('.LIST'),
});
/** Returns the <ROW> list, or an empty array when the response has no rows. */
export function parseRows(xml) {
    const parsed = rowParser.parse(xml);
    const rows = parsed?.['DATA']?.['ROW'];
    return Array.isArray(rows) ? rows : [];
}
/** Extracts the message from a Tally <EXCEPTION> response. */
export function exceptionMessage(xml) {
    const match = xml.match(/<EXCEPTION>(.+)<\/EXCEPTION>/);
    return match?.[1] ?? 'Unknown error';
}
export function parseText(value) {
    return utility.String.unescapeHTML(value).replace(/&#\d+;/g, ''); // drop unreadable characters
}
export function parseNumber(value) {
    if (!value)
        return 0;
    return parseFloat(value.replace(/[\(\),]+/g, ''));
}
/** Tally writes a quantity as '12.5 Nos', so the unit is trimmed off. */
export function parseQuantity(value) {
    const match = /^(-?\d+\.\d+|-?\d+)\s.+/.exec(value);
    const parsed = match ? parseFloat(match[1]) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
}
export function parseDate(value) {
    if (/^\d\d\d\d-\d\d-\d\d$/.test(value))
        return utility.Date.parse(value, 'yyyy-MM-dd');
    if (/^\d?\d-\w\w\w-\d\d\d\d$/.test(value))
        return utility.Date.parse(value, 'd-MMM-yyyy');
    if (/^\d?\d-\w\w\w-\d\d$/.test(value))
        return utility.Date.parse(value, 'd-MMM-yy');
    return null;
}
//# sourceMappingURL=parse.mjs.map