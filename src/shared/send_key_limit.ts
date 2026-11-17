// The most key pairs one `page.send_key` call sends. The schema caps `times` with it, and the handler checks it again, because the content script fills `times` from the count prefix after the compile check.
export const SEND_KEY_MAX_TIMES = 99;
