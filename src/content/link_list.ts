// The lines of a copied link list, shared by the page links (`hints/yank_links.ts`) and the open tabs (`commands/copy_tabs.ts`), so both read alike.
// Pure and DOM-free, so the background can use it too.

import { link_text, markdown_address, org_address } from "./link_escape.ts";

export type ListedLink = { url: string; text: string };

export const LIST_FORMATS = ["markdown", "plain", "org", "title"] as const;
export type ListFormat = (typeof LIST_FORMATS)[number];

export function format_link_list(links: readonly ListedLink[], format: ListFormat): string {
  return links
    .map(({ url, text }) => {
      switch (format) {
        case "plain":
          return url;
        case "title":
          return text;
        case "markdown":
          return `- [${link_text(text)}](${markdown_address(url)})`;
        case "org":
          return `- [[${org_address(url)}][${link_text(text)}]]`;
      }
    })
    .join("\n");
}
