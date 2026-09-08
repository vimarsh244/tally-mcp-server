/**
 * Writing to Tally: importing masters, deleting masters, invoking actions.
 */
import { XMLParser } from 'fast-xml-parser';
import { hasTemplate } from '../templates.mjs';
import { sendTallyXml } from './client.mjs';
import { assertTallyResponse, tallyError } from './parse.mjs';
const responseParser = new XMLParser();
/**
 * Tally answers an import with a single <RESPONSE> element of counters.
 *
 * A response with no counters at all is a failed request, not an import that
 * changed nothing, so it is reported rather than returned as an empty object.
 * A response that carries both counters and a line error is a partial success
 * and keeps both.
 */
function importStatus(xml) {
    const status = responseParser.parse(xml)?.['RESPONSE'];
    if (!status || typeof status !== 'object')
        assertTallyResponse(xml); // throws when the body explains itself
    if (!status || typeof status !== 'object')
        throw new Error('Unexpected response structure received from Tally for an import request');
    const lineError = tallyError(xml);
    return lineError ? { ...status, lineErrors: [lineError] } : status;
}
export async function invokeTallyAction(targetAction, lstParameters) {
    const args = new Map();
    args.set('targetReport', targetAction);
    args.set('variables', [...lstParameters].map(([name, value]) => ({ name, value })));
    await sendTallyXml('generic/invoke-action', args);
}
/**
 * Sends one Import Data request built from a templates/push template and
 * returns Tally's counters. Masters and vouchers share this path, they differ
 * only in the template they render.
 */
export async function importTemplate(name, input) {
    const template = `push/${name}`;
    if (!hasTemplate(template))
        throw new Error(`No XML template for import [${name}]`);
    return importStatus(await sendTallyXml(template, input));
}
export async function importMasters(targetMaster, objMasterInput) {
    return importTemplate(targetMaster, objMasterInput);
}
export async function deleteMasters(targetCollection, lstMaster, targetCompany) {
    const args = new Map();
    args.set('targetCollection', targetCollection);
    args.set('masters', lstMaster);
    if (targetCompany)
        args.set('targetCompany', targetCompany);
    return importStatus(await sendTallyXml('generic/delete-master', args));
}
//# sourceMappingURL=masters.mjs.map