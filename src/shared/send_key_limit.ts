// The most key pairs one `page.send_key` call sends. The schema caps `times` with it, and the handler checks it again, because the content script fills `times` from the count prefix after the compile check.
export const SEND_KEY_MAX_TIMES = 99;

// The most presses of one `until_stable` run of `page.send_key`, enough to cross a list of thousands of files one item a press.
export const UNTIL_STABLE_MAX_PRESSES = 5000;
// Presses in a row that may leave the focus where it was before an `until_stable` run ends, for a page that moves the focus a little late.
export const UNTIL_STABLE_RETRIES = 2;
// The pause after each press of an `until_stable` run.
export const UNTIL_STABLE_PAUSE_MS = 20;
