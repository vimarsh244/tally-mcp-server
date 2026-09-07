/**
 * A realm is one authentication boundary.
 *
 * In single user mode there is one realm, served at the root, that uses the
 * password and the Tally port from the environment. With MULTI_USER=1 there is
 * one realm per profile, served under /u/<id>, and the root realm is switched
 * off. That matters: leaving the root reachable would give every signed in
 * Windows user an unscoped route to the default Tally port, which is exactly
 * the isolation the profiles exist to provide.
 */
import { config } from '../config.mjs';
import { safeEqualsHex } from '../profiles.mjs';
export const profilePath = (id) => `/u/${encodeURIComponent(id)}`;
/** The realm that single user deployments have always used. */
export function rootRealm() {
    return {
        id: '',
        basePath: '',
        issuer: config.domain,
        resource: `${config.domain}/mcp`,
        tally: { host: config.tallyHost, port: config.tallyPort, timeout: config.tallyTimeout },
        blockWrite: config.blockWrite,
        verifyPassword: (password) => safeEqualsHex(config.password, password),
        // the root realm has no registry behind it, so there is no token to compare
        verifyStaticToken: () => false,
    };
}
export function realmForProfile(profiles, id) {
    const profile = profiles.get(id);
    if (!profile)
        return undefined;
    const basePath = profilePath(profile.id);
    return {
        id: profile.id,
        basePath,
        issuer: `${config.domain}${basePath}`,
        resource: `${config.domain}${basePath}/mcp`,
        tally: { host: profile.tallyHost, port: profile.tallyPort, timeout: config.tallyTimeout },
        blockWrite: profile.blockWrite,
        verifyPassword: (password) => profiles.verifyPassword(profile.id, password),
        verifyStaticToken: (token) => profiles.verifyToken(profile.id, token),
    };
}
/**
 * Builds the resolver the routes use. A request under /u/<id> resolves to that
 * profile; anything else resolves to the root realm, unless multi user mode
 * has switched the root realm off.
 */
export function createRealmResolver(profiles) {
    return (req) => {
        const id = req.params?.['profileId'];
        if (typeof id === 'string' && id !== '')
            return profiles ? realmForProfile(profiles, id) : undefined;
        return config.multiUser ? undefined : rootRealm();
    };
}
//# sourceMappingURL=realm.mjs.map