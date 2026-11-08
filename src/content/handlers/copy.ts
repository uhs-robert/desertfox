import type { Outcome } from "../../shared/messages.ts";
import { link_text, markdown_address, org_address } from "../link_escape.ts";
import { show_toast } from "../ui_proxy.ts";
import type { ContentHandler } from "./types.ts";

export const COPY_FORMATS = ["plain", "canonical", "short", "title", "markdown", "org"] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

export type PageLinkFacts = {
  url: string;
  title: string;
  canonical_url: string | undefined;
  short_url: string | undefined;
};

export function format_page_link(format: CopyFormat, facts: PageLinkFacts): string {
  const { url, title } = facts;
  switch (format) {
    case "plain":
      return url;
    case "canonical":
      return facts.canonical_url ?? url;
    case "short":
      return facts.short_url ?? url;
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

export const copy_url: ContentHandler = {
  run: (args) => {
    const text = format_page_link(args.format as CopyFormat, {
      url: location.href,
      title: document.title,
      canonical_url: link_href("canonical"),
      short_url: link_href("shortlink"),
    });
    // The failure goes to the caller, which shows it once.
    return navigator.clipboard.writeText(text).then(
      () => show_toast(`Copied ${text}`),
      (): Outcome => ({ ok: false, message: "Could not copy to the clipboard" }),
    );
  },
};
