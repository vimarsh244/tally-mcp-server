/**
 * Writing to Tally: importing masters, deleting masters, invoking actions.
 */

import { XMLParser } from 'fast-xml-parser';
import * as m from '../models.mjs';
import { hasTemplate } from '../templates.mjs';
import { sendTallyXml } from './client.mjs';

const responseParser = new XMLParser();

/** Tally answers an import with a single <RESPONSE> element of counters. */
function importStatus(xml: string): m.CreateUpdateDeleteStatus {
    return responseParser.parse(xml)?.['RESPONSE'] ?? {};
}

export async function invokeTallyAction(targetAction: string, lstParameters: Map<string, any>): Promise<void> {
    const args = new Map<string, any>();
    args.set('targetReport', targetAction);
    args.set('variables', [...lstParameters].map(([name, value]) => ({ name, value })));

    await sendTallyXml('generic/invoke-action', args);
}

export async function importMasters(targetMaster: string, objMasterInput: Map<string, any>): Promise<m.CreateUpdateDeleteStatus> {
    const template = `push/${targetMaster}`;
    if (!hasTemplate(template))
        throw new Error(`No XML template for master [${targetMaster}]`);

    return importStatus(await sendTallyXml(template as `push/${string}`, objMasterInput));
}

export async function deleteMasters(targetCollection: string, lstMaster: string[], targetCompany?: string): Promise<m.CreateUpdateDeleteStatus> {
    const args = new Map<string, any>();
    args.set('targetCollection', targetCollection);
    args.set('masters', lstMaster);
    if (targetCompany) args.set('targetCompany', targetCompany);

    return importStatus(await sendTallyXml('generic/delete-master', args));
}
