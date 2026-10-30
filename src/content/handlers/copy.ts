import { show_toast } from "../toast.ts";
import type { ContentHandler } from "./types.ts";

export const COPY_FORMATS = ["plain", "canonical", "short", "title", "markdown", "org"] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

export type PageLinkFacts = {
  url: string;
  title: string;
  canonical_url: string | undefined;
  short_url: string | undefined;
};

// Square brackets in a title would end the link text early.
const link_text = (title: string) => title.replace(/\[/g, "(").replace(/\]/g, ")");

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
      return `[${link_text(title)}](${url.replace(/\)/g, "%29")})`;
    case "org":
      return `[[${url}][${link_text(title)}]]`;
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
    navigator.clipboard.writeText(text).then(
      () => show_toast(`Copied ${text}`),
      () => show_toast("Could not copy to the clipboard"),
    );
  },
};
