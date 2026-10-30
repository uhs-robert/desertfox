import { COPY_FORMATS, copy_url } from "../content/handlers/copy.ts";
import { define } from "../shared/registry/index.ts";

define("copy.url", {
  name: "copy",
  label: "Copy URL",
  intent: "Copy the page address to the clipboard, as plain text, a canonical or short link, the title, or a markdown or org link.",
  params: [{ name: "format", type: "enum", values: COPY_FORMATS, default: "plain" }],
  runs_in: "content",
  run: copy_url.run,
});
