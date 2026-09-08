/** Tools that change Tally's global company and period context. */

import { utility } from '../utility.mjs';
import { forgetCompanies, invokeTallyAction } from '../tally/index.mjs';
import { changesContext, guard, isoDate, ok, type ToolModule } from './shared.mjs';
import { z } from 'zod';

export const contextTools: ToolModule = ({ server }) => {

    server.registerTool('set-company', {
        title: 'Set Company',
        description: 'sets the active company context in Tally Prime. This changes the global company context used by Tally for subsequent operations and report queries',
        inputSchema: {
            companyName: z.string().describe('company name to set as active, validate it using list-master tool with collection as company'),
        },
        // changes state in Tally, so it is not read only
        annotations: changesContext,
    }, guard(async (args) => {
        await invokeTallyAction('ChangeCurrentCompany', new Map([['SVCurrentCompany', utility.String.escapeHTML(args.companyName)]]));
        forgetCompanies(); // a different company is active now
        return ok('OK');
    }));

    server.registerTool('set-period', {
        title: 'Set Period',
        description: 'sets the active reporting period in Tally Prime by specifying a from date and to date. This changes the global period context used by Tally for subsequent report queries',
        inputSchema: {
            fromDate: isoDate().describe('start date of the period'),
            toDate: isoDate().describe('end date of the period'),
        },
        annotations: changesContext,
    }, guard(async (args) => {
        await invokeTallyAction('Change Period', new Map([
            ['SVFromDate', utility.Date.format(new Date(args.fromDate), 'd-MMM-yyyy')],
            ['SVToDate', utility.Date.format(new Date(args.toDate), 'd-MMM-yyyy')],
        ]));
        return ok('OK');
    }));
};
