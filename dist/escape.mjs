/**
 * Escaping helpers for the two languages this server generates.
 *
 * Every call site used to inline its own rule. Some stripped double quotes,
 * others doubled them, for the same kind of value, so a name containing a
 * quote behaved differently depending on which tool was called.
 */
/**
 * Escapes a value for use inside a double quoted TDL string literal.
 *
 * TDL has no escape character inside a quoted literal, so an embedded double
 * quote cannot be represented and is removed. Newlines would end the
 * expression, so they go too.
 */
export function tdlString(value) {
    return value.replace(/"/g, '').replace(/[\r\n]+/g, ' ');
}
/** Wraps a value as a quoted TDL string literal. */
export function tdlQuoted(value) {
    return `"${tdlString(value)}"`;
}
/** Quotes a PostgreSQL identifier so a column name cannot break out of the statement. */
export function sqlIdentifier(name) {
    return `"${name.replace(/"/g, '""')}"`;
}
//# sourceMappingURL=escape.mjs.map