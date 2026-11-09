import { COPY_FORMATS } from "../content/handlers/copy.ts";
import { define } from "../shared/registry/builtin.ts";

define("copy.url", {
  name: "copy",
  label: "Copy URL",
  intent: "Copy the page address or a link. The clipboard gets the address, the title or a link in one of six formats.",
  params: [
    {
      name: "format",
      type: "enum",
      values: COPY_FORMATS,
      default: "plain",
      short: { canonical: "C", short: "s", title: "T", markdown: "m", org: "o" },
      value_labels: { canonical: "in canonical form", short: "shortened", title: "as page title", markdown: "as Markdown link", org: "as Org link" },
      description: {
        canonical: "Copy the canonical address.",
        short: "Copy the shortened address.",
        title: "Copy the page title.",
        markdown: "Copy a Markdown link.",
        org: "Copy an Org link.",
      },
    },
  ],
  runs_in: "content",
  bundle: "page",
});

define("copy.links", {
  name: "copylinks",
  label: "Copy links",
  intent: "Copy the web links of the page as a list. The clipboard gets one line per link, the whole page or only what is in view, as Markdown, Org or plain addresses.",
  params: [
    {
      name: "scope",
      type: "enum",
      values: ["page", "viewport"],
      default: "page",
      short: { viewport: "v" },
      value_labels: { viewport: "in view" },
      description: { viewport: "Copy only the links in view." },
    },
    {
      name: "format",
      type: "enum",
      values: ["markdown", "plain", "org"],
      default: "markdown",
      short: { plain: "u", org: "o" },
      value_labels: { plain: "as plain addresses", org: "as an Org list" },
      description: { plain: "Copy the addresses, one per line.", org: "Copy an Org list." },
    },
  ],
  runs_in: "content",
  bundle: "hints",
});
