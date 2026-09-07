/**
 * A stand-in Tally XML server, so the tools can be exercised without Tally.
 * It records every request body and answers with a fixed row.
 */
import http from 'node:http';

const ROW = '<ROW>'
    + '<NAME>Acme Ltd</NAME><PARENT>Sundry Debtors</PARENT><_PRIMARYGROUP>Sundry Debtors</_PRIMARYGROUP>'
    + '<ISREVENUE>0</ISREVENUE><ISDEEMEDPOSITIVE>1</ISDEEMEDPOSITIVE><AFFECTSGROSSPROFIT>0</AFFECTSGROSSPROFIT>'
    + '<SORTPOSITION>10</SORTPOSITION><OPENINGBALANCE>100</OPENINGBALANCE><CLOSINGBALANCE>250.5</CLOSINGBALANCE>'
    + '<DEBITTOTALS>50</DEBITTOTALS><CREDITTOTALS>25</CREDITTOTALS><BOOKSFROM>2024-04-01</BOOKSFROM>'
    + '<ISACTIVECOMPANY>Yes</ISACTIVECOMPANY><UNIT>Nos</UNIT><OPENINGVALUE>10</OPENINGVALUE>'
    + '<INWARDQUANTITY>5</INWARDQUANTITY><INWARDVALUE>500</INWARDVALUE><OUTWARDQUANTITY>2</OUTWARDQUANTITY>'
    + '<OUTWARDVALUE>200</OUTWARDVALUE><CLOSINGVALUE>310</CLOSINGVALUE><BILLDATE>2024-05-01</BILLDATE>'
    + '<_OVERDUEDAYS>30</_OVERDUEDAYS><GUID>g-1</GUID><DATE>2024-05-01</DATE><VOUCHER_TYPE>Sales</VOUCHER_TYPE>'
    + '<VOUCHER_NUMBER>V1</VOUCHER_NUMBER><ALTERNATE_LEDGER>Sales A/c</ALTERNATE_LEDGER>'
    + '<PARTY_LEDGER>Acme Ltd</PARTY_LEDGER><AMOUNT>100</AMOUNT><NARRATION>note</NARRATION>'
    + '<QUANTITY>3 Nos</QUANTITY><TRACKING_NUMBER></TRACKING_NUMBER><VOUCHER_CATEGORY>Sales</VOUCHER_CATEGORY>'
    + '</ROW>';

export async function startFakeTally(port = 9000) {
    const requests = [];
    let respondWith = null; // string, or a function of the request body

    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf16le');
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            requests.push(body);
            const override = typeof respondWith === 'function' ? respondWith(body) : respondWith;
            const out = override
                ?? (/TALLYREQUEST>Import Data/.test(body)
                    ? '<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>1</DELETED></RESPONSE>'
                    : `<DATA>${ROW}</DATA>`);
            res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-16' });
            res.end(Buffer.from(out, 'utf16le'));
        });
    });

    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

    return {
        requests,
        lastRequest: () => requests[requests.length - 1],
        /** Accepts a fixed string, or a function returning a string (or null to fall through). */
        setResponse: (xmlOrFn) => { respondWith = xmlOrFn; },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** Calls a registered tool and returns its single text payload. */
export async function callTool(server, name, args) {
    const tool = server._registeredTools[name];
    if (!tool) throw new Error(`No such tool: ${name}`);
    const result = await tool.handler(args, {});
    return { isError: result.isError === true, text: result.content[0].text };
}
