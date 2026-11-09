import type { Outcome } from "../../shared/messages.ts";
import { link_text, markdown_address, org_address } from "../link_escape.ts";

export const COPY_FORMATS = ["plain", "canonical", "short", "title", "markdown", "org"] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

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

function link_href(rel: string): string | undefined {
  return document.querySelector<HTMLLinkElement>(`link[rel~="${rel}"][href]`)?.href || undefined;
}

export function copy_page_url(format: CopyFormat, show_toast: (message: string) => void): Promise<Outcome | void> {
  const text = format_page_link(format, {
    url: location.href,
    title: document.title,
    canonical_url_: link_href("canonical"),
    short_url_: link_href("shortlink"),
  });
  // The failure goes to the caller, which shows it once.
  return navigator.clipboard.writeText(text).then(
    () => show_toast(`Copied ${text}`),
    (): Outcome => ({ ok: false, message: "Could not copy to the clipboard" }),
  );
}
