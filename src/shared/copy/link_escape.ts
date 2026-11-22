// The escapes of a copied link, shared by the page link (`handlers/copy.ts`) and the link list (`hints/yank_links.ts`).
// Pure and import-free, so the hints bundle can use it without pulling in the toast proxy.

// Square brackets in a title would end the link text early.
export const link_text = (title: string) => title.replace(/\[/g, "(").replace(/\]/g, ")");

// A closing parenthesis would end a Markdown address early.
export const markdown_address = (url: string) => url.replace(/\)/g, "%29");

// A closing bracket would end an Org address early.
export const org_address = (url: string) => url.replace(/]/g, "%5D");
