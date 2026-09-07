/**
 * Transport for the Tally XML server: renders a template and posts it.
 */
import http from 'node:http';
import { currentTallyTarget } from '../tally-target.mjs';
import { renderTemplate } from '../templates.mjs';
/** Tally's own default for the current company, which must not be sent explicitly. */
const DEFAULT_COMPANY = '##SVCurrentCompany';
export async function sendTallyXml(template, variables) {
    const args = {};
    for (const [key, value] of variables) {
        // passing the default company through would override Tally's active selection
        if (key === 'targetCompany' && value === DEFAULT_COMPANY)
            continue;
        args[key] = value;
    }
    return postTallyXml(renderTemplate(template, args));
}
export function postTallyXml(xml) {
    // read once per call, so a target that changes between calls is honoured
    const target = currentTallyTarget();
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: target.host,
            port: target.port,
            path: '',
            method: 'POST',
            timeout: target.timeout,
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
            request.destroy(new Error(`Tally did not respond within ${target.timeout} ms on port ${target.port}`));
        });
        request.on('error', (error) => {
            // error.message reads 'connect ECONNREFUSED 127.0.0.1:9000', so the code must be
            // tested rather than the message, or this guidance never shows
            if (error.code === 'ECONNREFUSED')
                reject(new Error(`Unable to connect to Tally on ${target.host}:${target.port}. Ensure Tally is running and XML server is enabled on port ${target.port} by going to Help (F1) > Settings > Connectivity in Tally and setting Client / Server configuration, set Tally Prime is action as Server`));
            else
                reject(error);
        });
        request.write(xml, 'utf16le');
        request.end();
    });
}
//# sourceMappingURL=client.mjs.map