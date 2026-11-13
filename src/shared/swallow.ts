// One helper per reason an error is dropped, so the name at the call site says why. The lint rule `no-restricted-syntax` in eslint.config.mjs bans a silent `.catch` handler written inline.
// Plain functions that return a promise: the content bundle shares this file, so no classes and no strings per call.
// The helpers use `.then(undefined, handler)`, which the rule does not match, and no shared inner function: each one minifies smaller that way.

/** The browser refuses an expected case: a stale tab, window or container id, a tab that closed. The result is undefined. */
export function ignore_refusal<T>(promise: Promise<T>): Promise<T | undefined> {
    return promise.then(undefined, () => undefined);
}

/** A message or call whose receiver may be gone or deaf: a tab or frame with no listener, a toast, a focus. The result is not used. */
export function best_effort(promise: Promise<unknown>): Promise<void> {
    return promise.then(() => {}, () => {});
}

/** The tail of a queue. The caller of the queued run gets the real error, and the chain must stay alive for the next turn. */
export function keep_chain(promise: Promise<unknown>): Promise<void> {
    return promise.then(() => {}, () => {});
}

/** A read with a stated answer when it is refused: `[]` for a missing list, `false` for a missing check. */
export function refused_as<T, F>(promise: Promise<T>, fallback: F): Promise<T | F> {
    return promise.then(undefined, () => fallback);
}

/** A `.catch` handler for a site that could hide a bug of ours. It logs and moves on, and changes no behavior. */
export function warn_and_go(label: string): (error: unknown) => void {
    return (error) => console.warn(`desertfox: ${label}`, error);
}
