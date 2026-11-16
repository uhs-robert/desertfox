// True only in the build the key test loads. `tools/build.mjs` defines `__KEY_TEST__` there, so the release bundles drop every branch behind this flag.
// The `typeof` form keeps the unit tests, which run the source with no define, reading it as false.
declare const __KEY_TEST__: boolean | undefined;

export const KEY_TEST_BUILD: boolean = typeof __KEY_TEST__ !== "undefined" && __KEY_TEST__;
