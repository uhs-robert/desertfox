// The text of a yanked page link in one of the six formats. Pure and DOM-free: the page bundle fills the facts from the document, and the background command `copy.page` from the tab.

import type { CopyFormat } from "../command.ts";
import { link_text, markdown_address, org_address } from "./link_escape.ts";

export type PageLinkFacts = {
  url: string;
  title: string;
  canonical_url_: string | undefined;
  short_url_: string | undefined;
};

export function format_page_link(format: CopyFormat, facts: PageLinkFacts): string {
  const { url, title } = facts;
  switch (format) {
    case "plain":
      return url;
    case "canonical":
      return facts.canonical_url_ ?? url;
    case "short":
      return facts.short_url_ ?? url;
    case "title":
      return title;
    case "markdown":
      return `[${link_text(title)}](${markdown_address(url)})`;
    case "org":
      return `[[${org_address(url)}][${link_text(title)}]]`;
  }
}
