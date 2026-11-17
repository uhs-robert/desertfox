// The most key pairs one `page.send_key` call sends. The schema caps `times` with it, and the handler checks it again, because the content script fills `times` from the count prefix after the compile check.
export const SEND_KEY_MAX_TIMES = 99;

// The most presses of one `until_stable` run of `page.send_key`, enough to cross a list of thousands of files one item a press.
export const UNTIL_STABLE_MAX_PRESSES = 5000;
// How long the focus may stay put before an `until_stable` run ends. Long enough for a page that fetches the next part of a list over the network.
export const UNTIL_STABLE_STALL_MS = 750;
// While the focus moves, a run yields to the page after this many presses, so it draws the next rows and a user's key lands. Firefox holds a nested 0 ms timer to 4 ms, so a yield per press would be slow.
export const UNTIL_STABLE_YIELD_EVERY = 16;
// The first pause once the focus stops moving. Each later pause doubles it.
export const UNTIL_STABLE_FIRST_PAUSE_MS = 20;
