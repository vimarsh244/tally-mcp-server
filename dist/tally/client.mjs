/**
 * Transport for the Tally XML server: renders a template and posts it.
 */
import http from 'node:http';
import { config } from '../config.mjs';
import { currentTallyTarget } from '../tally-target.mjs';
import { renderTemplate } from '../templates.mjs';
import { record } from '../trace.mjs';
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
const lanes = new Map();
/** Takes a slot, waiting when the lane is full. */
async function acquire(key) {
    if (config.tallyMaxConcurrent <= 0)
        return 0;
    const lane = lanes.get(key) ?? { running: 0, waiting: [] };
    lanes.set(key, lane);
    if (lane.running < config.tallyMaxConcurrent) {
        lane.running++;
        return 0;
    }
    const queuedAt = process.hrtime.bigint();
    // the slot is handed straight over on release, so the count never overshoots
    await new Promise((resolve) => lane.waiting.push(resolve));
    return Math.round(Number(process.hrtime.bigint() - queuedAt) / 1e3) / 1e3;
}
function release(key) {
    const lane = lanes.get(key);
    if (!lane)
        return;
    const next = lane.waiting.shift();
    if (next) {
        next(); // the slot passes on, so running stays as it is
        return;
    }
    lane.running--;
    if (lane.running <= 0)
        lanes.delete(key);
}
export async function postTallyXml(xml) {
    // read once per call, so a target that changes between calls is honoured
    const target = currentTallyTarget();
    const key = `${target.host}:${target.port}`;
    const waitedMs = await acquire(key);
    record('tally.queue', waitedMs);
    try {
        return await sendRequest(target, xml);
    }
    finally {
        release(key);
    }
}
function sendRequest(target, xml) {
    const started = process.hrtime.bigint();
    const elapsedMs = () => Math.round(Number(process.hrtime.bigint() - started) / 1e3) / 1e3;
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
            // Tally builds the whole report before it answers, so the wait for
            // the first byte and the transfer of the body are separate costs
            const headersMs = elapsedMs();
            let data = '';
            response
                .setEncoding('utf16le')
                .on('data', (chunk) => { data += chunk.toString() || ''; })
                .on('end', () => {
                record('tally.request', elapsedMs(), {
                    headersMs,
                    requestBytes: Buffer.byteLength(xml, 'utf16le'),
                    responseBytes: Buffer.byteLength(data, 'utf16le'),
                    status: response.statusCode,
                });
                resolve(data);
            })
                .on('error', reject);
        });
        // without this the request waits forever when Tally accepts the socket but never replies
        request.on('timeout', () => {
            request.destroy(new Error(`Tally did not respond within ${target.timeout} ms on port ${target.port}`));
        });
        request.on('error', (error) => {
            record('tally.request', elapsedMs(), { failed: true, code: error.code });
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