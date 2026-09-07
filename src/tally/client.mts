/**
 * Transport for the Tally XML server: renders a template and posts it.
 */

import http from 'node:http';
import { config } from '../config.mjs';
import { renderTemplate, type TemplateName } from '../templates.mjs';

/** Tally's own default for the current company, which must not be sent explicitly. */
const DEFAULT_COMPANY = '##SVCurrentCompany';

export async function sendTallyXml(template: TemplateName, variables: Map<string, any>): Promise<string> {
    const args: Record<string, any> = {};
    for (const [key, value] of variables) {
        // passing the default company through would override Tally's active selection
        if (key === 'targetCompany' && value === DEFAULT_COMPANY) continue;
        args[key] = value;
    }

    return postTallyXml(renderTemplate(template, args));
}

export function postTallyXml(xml: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const request = http.request({
            hostname: config.tallyHost,
            port: config.tallyPort,
            path: '',
            method: 'POST',
            timeout: config.tallyTimeout,
            headers: {
                'Content-Length': Buffer.byteLength(xml, 'utf16le'),
                'Content-Type': 'text/xml;charset=utf-16'
            }
        }, (response) => {
            let data = '';
            response
                .setEncoding('utf16le')
                .on('data', (chunk) => { data += chunk.toString() || ''; })
                .on('end', () => resolve(data))
                .on('error', reject);
        });

        // without this the request waits forever when Tally accepts the socket but never replies
        request.on('timeout', () => {
            request.destroy(new Error(`Tally did not respond within ${config.tallyTimeout} ms on port ${config.tallyPort}`));
        });

        request.on('error', (error: NodeJS.ErrnoException) => {
            // error.message reads 'connect ECONNREFUSED 127.0.0.1:9000', so the code must be
            // tested rather than the message, or this guidance never shows
            if (error.code === 'ECONNREFUSED')
                reject(new Error(`Unable to connect to Tally. Ensure Tally is running and XML server is enabled on port ${config.tallyPort} by going to Help (F1) > Settings > Connectivity in Tally and setting Client / Server configuration, set Tally Prime is action as Server`));
            else
                reject(error);
        });

        request.write(xml, 'utf16le');
        request.end();
    });
}
