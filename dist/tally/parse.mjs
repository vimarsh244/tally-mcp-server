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
const EXCEPTION = /<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/;
const LINE_ERROR = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/;
const STATUS_ZERO = /<STATUS>\s*0\s*<\/STATUS>/;
/**
 * Describes why a response is not a usable answer, or undefined when it is.
 *
 * Tally reports a failure in several shapes, and a request made while no
 * company is open comes back as an envelope carrying STATUS 0 rather than as
 * anything that looks like an error. Every one of them used to parse to an
 * empty row list, so a failed report was indistinguishable from a report with
 * nothing in it.
 */
export function tallyError(xml) {
    if (!xml || !xml.trim())
        return 'Empty response received from Tally. Check that Tally is running, that a company is open, and that the request reached the XML port';
    const exception = EXCEPTION.exec(xml);
    if (exception)
        return parseText(exception[1].trim()) || 'Tally reported an exception';
    const lineError = LINE_ERROR.exec(xml);
    if (lineError)
        return parseText(lineError[1].trim()) || 'Tally reported an error';
    // an export that succeeded carries the data tag, whatever else is around it
    if (STATUS_ZERO.test(xml) && !/<DATA[\s>]/.test(xml))
        return 'Tally refused the request. The usual cause is that no company is open, or that the company named is not loaded';
    return undefined;
}
/** Throws when the response is not a usable answer. */
export function assertTallyResponse(xml) {
    const error = tallyError(xml);
    if (error)
        throw new Error(error);
}
/**
 * Returns the <ROW> list. An answer that carries the data tag with nothing in
 * it is a real result of zero rows, not a failure, so it yields an empty array.
 */
export function parseRows(xml) {
    assertTallyResponse(xml);
    const parsed = rowParser.parse(xml);
    if (!parsed || !('DATA' in parsed))
        throw new Error('Unexpected response structure received from Tally');
    const rows = parsed['DATA']?.['ROW'];
    return Array.isArray(rows) ? rows : [];
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