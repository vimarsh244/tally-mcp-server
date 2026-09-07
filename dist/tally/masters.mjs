/**
 * Writing to Tally: importing masters, deleting masters, invoking actions.
 */
import { XMLParser } from 'fast-xml-parser';
import { hasTemplate } from '../templates.mjs';
import { sendTallyXml } from './client.mjs';
const responseParser = new XMLParser();
/** Tally answers an import with a single <RESPONSE> element of counters. */
function importStatus(xml) {
    return responseParser.parse(xml)?.['RESPONSE'] ?? {};
}
export async function invokeTallyAction(targetAction, lstParameters) {
    const args = new Map();
    args.set('targetReport', targetAction);
    args.set('variables', [...lstParameters].map(([name, value]) => ({ name, value })));
    await sendTallyXml('generic/invoke-action', args);
}
export async function importMasters(targetMaster, objMasterInput) {
    const template = `push/${targetMaster}`;
    if (!hasTemplate(template))
        throw new Error(`No XML template for master [${targetMaster}]`);
    return importStatus(await sendTallyXml(template, objMasterInput));
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