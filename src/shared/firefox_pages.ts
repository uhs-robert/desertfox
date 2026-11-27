// The fixed list of Firefox's own pages that `browser.open_firefox_page` (`:firefox`) opens. Every route takes only the name: the browser module, the native host and the clipboard each find the address in their own copy.
// A page joins the list only when opening it changes nothing, and it joins every copy in one change: FIREFOX_PAGES in host/desertfox-host, the core's MODULE_FIREFOX_PAGES in browser_module/desertfox-browser.js and the PAGES table in browser_module/desertfox-firefox-pages.js, which tests compare.

// The pages with an address, which every route can open.
export const FIREFOX_PAGE_ADDRESSES = {
  settings: "about:preferences",
  "settings-general": "about:preferences#general",
  "settings-home": "about:preferences#home",
  "settings-search": "about:preferences#search",
  "settings-privacy": "about:preferences#privacy",
  "settings-sync": "about:preferences#sync",
  addons: "about:addons",
  downloads: "about:downloads",
  config: "about:config",
  profiles: "about:profiles",
  support: "about:support",
  debugging: "about:debugging#/runtime/this-firefox",
  logins: "about:logins",
  processes: "about:processes",
  memory: "about:memory",
  policies: "about:policies",
  crashes: "about:crashes",
  protections: "about:protections",
} as const;

export type AddressedFirefoxPage = keyof typeof FIREFOX_PAGE_ADDRESSES;

// Views with no address of their own, which only the module opens: the host and the clipboard refuse them.
export const MODULE_ONLY_FIREFOX_PAGES = ["addons-shortcuts"] as const;

export const FIREFOX_PAGES = [...(Object.keys(FIREFOX_PAGE_ADDRESSES) as AddressedFirefoxPage[]), ...MODULE_ONLY_FIREFOX_PAGES] as const;
export type FirefoxPage = (typeof FIREFOX_PAGES)[number];

// about:logins shows saved sites and usernames, so it stays on the host and the clipboard, which open it in a new tab only.
const HOST_ONLY_FIREFOX_PAGES: readonly FirefoxPage[] = ["logins"];
// The names the module takes. The protocol checks a request against this list, so the extension never asks the module for another page.
export const MODULE_FIREFOX_PAGES = FIREFOX_PAGES.filter((page) => !HOST_ONLY_FIREFOX_PAGES.includes(page));

export const has_address = (page: FirefoxPage): page is AddressedFirefoxPage => Object.hasOwn(FIREFOX_PAGE_ADDRESSES, page);

// Firefox takes about:settings for about:preferences, so typed text of either form names the same page.
const SETTINGS_ALIAS = /^about:settings(?=$|#)/;

// The page whose address is exactly `text`, ignoring case and outer spaces, or undefined. Typed text and a followed link's address: an address with a query or another fragment names no page.
export function firefox_page_at(text: string): AddressedFirefoxPage | undefined {
  const typed = text.trim().toLowerCase().replace(SETTINGS_ALIAS, "about:preferences");
  return (Object.keys(FIREFOX_PAGE_ADDRESSES) as AddressedFirefoxPage[]).find((page) => FIREFOX_PAGE_ADDRESSES[page].toLowerCase() === typed);
}
