/**
 * Access to the Tally XML templates compiled from templates/**\/*.njk.
 */

import nunjucks from 'nunjucks';
import { utility } from './utility.mjs';
import { tallyTemplates } from './templates.generated.mjs';

export type TemplateName =
    | 'generic/query-collection'
    | 'generic/delete-master'
    | 'generic/invoke-action'
    | `report/${string}`
    | `push/${string}`;

const environment = new nunjucks.Environment();
environment.addFilter('formatDate', (dt: Date, format: string) => utility.Date.format(dt, format));

/**
 * Returns the compiled template source, or throws when the name is unknown.
 * A missing template used to yield an empty string, which reached Tally as an
 * empty request and failed with an unhelpful message.
 */
export function templateSource(name: TemplateName): string {
    const xml = tallyTemplates.get(name);
    if (!xml)
        throw new Error(`Unknown Tally template [${name}]`);
    return xml;
}

export function hasTemplate(name: string): boolean {
    return tallyTemplates.has(name);
}

/** Renders a template with the supplied variables. */
export function renderTemplate(name: TemplateName, variables: Record<string, any>): string {
    return environment.renderString(templateSource(name), variables);
}
