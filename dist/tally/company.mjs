/**
 * The company list, remembered for a short interval.
 *
 * Every ledger or stock item write asked Tally for the whole company list
 * first, only to read the books begin date out of it. That date does not
 * change, so the list is kept for a minute when the caller named the company
 * it wants.
 *
 * Which company is *active* can change at any moment, including from another
 * session pointing at the same Tally, so a caller that did not name a company
 * is always answered from a fresh query. Writing a master into the wrong
 * company is not a risk worth a saved round trip.
 */
import { currentTallyTarget } from '../tally-target.mjs';
import { queryCollection } from './collections.mjs';
const TTL_MS = 60_000;
const remembered = new Map();
const keyFor = () => {
    const target = currentTallyTarget();
    return `${target.host}:${target.port}`;
};
/**
 * Every company Tally knows, with its books begin date and whether it is the
 * active one. `named` says whether the caller has a company in mind: when it
 * does not, the answer is always read fresh.
 */
export async function companyList(named) {
    const key = keyFor();
    const entry = remembered.get(key);
    if (named && entry && Date.now() - entry.at < TTL_MS)
        return entry.rows;
    const rows = await queryCollection('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map());
    remembered.set(key, { at: Date.now(), rows });
    return rows;
}
/** Drops what is remembered, after anything that could have changed it. */
export function forgetCompanies() {
    remembered.clear();
}
//# sourceMappingURL=company.mjs.map