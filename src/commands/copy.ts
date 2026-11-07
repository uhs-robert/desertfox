import { COPY_FORMATS, copy_url } from "../content/handlers/copy.ts";
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
  run: copy_url.run,
});
