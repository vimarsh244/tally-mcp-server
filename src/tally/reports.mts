/**
 * Running the predefined TDL reports (ledger account, stock item account).
 */

import * as m from '../models.mjs';
import { utility } from '../utility.mjs';
import { lstReportConfig } from '../definition.mjs';
import { hasTemplate } from '../templates.mjs';
import { sendTallyXml } from './client.mjs';
import { parseDate, parseNumber, parseQuantity, parseText, rowParser, tallyError } from './parse.mjs';

const reports: m.ModelPullReportInfo[] = lstReportConfig;

export async function fetchReport(targetReport: string, inputParams: Map<string, any>): Promise<m.ModelPullResponse> {
    const retval: m.ModelPullResponse = { data: undefined };

    try {
        const report = reports.find((r) => r.name === targetReport);
        if (!report) {
            retval.error = 'Invalid report';
            return retval;
        }

        const inputs = new Map<string, any>();
        // '##SVCurrentCompany' means 'whatever Tally has open', and is stripped before sending
        inputs.set('targetCompany', typeof inputParams.get('targetCompany') === 'string'
            ? inputParams.get('targetCompany')
            : '##SVCurrentCompany');

        for (const input of report.input) {
            const error = readInput(input, inputParams.get(input.name), inputs);
            if (error) {
                retval.error = error;
                return retval;
            }
        }

        return await extractReport(report, inputs);
    } catch (err) {
        retval.error = err instanceof Error ? err.message : 'Server exception';
        return retval;
    }
}

/** Validates and converts one report input, returning an error message when it is unusable. */
function readInput(input: m.ModelPullReportInputInfo, value: unknown, target: Map<string, any>): string | undefined {
    if (input.validation_regex && typeof value === 'string') {
        if (!new RegExp(input.validation_regex, 'i').test(value))
            return input.validation_message || `Invalid value for parameter ${input.name}`;
    }

    if (typeof value === 'number' && input.datatype === 'number') target.set(input.name, value);
    else if (typeof value === 'boolean' && input.datatype === 'boolean') target.set(input.name, value);
    else if (typeof value === 'string' && input.datatype === 'date' && /^\d\d-\d\d-\d\d\d\d$/.test(value))
        target.set(input.name, utility.Date.parse(value, 'dd-MM-yyyy')); // DD-MM-YYYY
    else if (typeof value === 'string' && input.datatype === 'date' && /^\d\d\d\d-\d\d-\d\d/.test(value))
        target.set(input.name, utility.Date.parse(value.substring(0, 10), 'yyyy-MM-dd')); // ISO
    else if (typeof value === 'string' && input.datatype === 'string') target.set(input.name, value);
    else return `Parameter ${input.name} not found or contains invalid value [${value}]`;

    return undefined;
}

async function extractReport(report: m.ModelPullReportInfo, inputs: Map<string, any>): Promise<m.ModelPullResponse> {
    const retval: m.ModelPullResponse = { data: undefined };

    const template = `report/${report.name}`;
    if (!hasTemplate(template))
        throw new Error(`No XML template for report [${report.name}]`);

    const response = await sendTallyXml(template as `report/${string}`, inputs);

    const error = tallyError(response);
    if (error) {
        retval.error = error;
        return retval;
    }

    const parsed = rowParser.parse(response);
    if (!parsed || !('DATA' in parsed)) {
        retval.error = 'Unexpected response structure received from Tally';
        return retval;
    }

    // a report that matched nothing answers with an empty data tag, which is a
    // result of zero rows rather than a failure
    const rows = parsed['DATA']?.['ROW'];
    if (!Array.isArray(rows)) {
        retval.data = [];
        return retval;
    }

    retval.data = rows.map((row) => {
        const item: Record<string, any> = {};
        for (const field of report.output)
            item[field.name] = convertOutput(row[field.name.toUpperCase()], field.datatype);
        return item;
    });

    return retval;
}

function convertOutput(raw: any, datatype: string): any {
    if (raw === undefined) return undefined;
    if (datatype === 'number') return parseNumber(raw);
    if (datatype === 'date') return parseDate(raw);
    if (datatype === 'boolean') return raw === '1';
    if (datatype === 'quantity') return parseQuantity(raw);
    return parseText(raw);
}
