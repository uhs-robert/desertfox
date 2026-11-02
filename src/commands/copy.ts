import { COPY_FORMATS, copy_url } from "../content/handlers/copy.ts";
import { define } from "../shared/registry/index.ts";

define("copy.url", {
  name: "copy",
  label: "Copy URL",
  intent: "Copy the page address, title or a link in one of six formats to the clipboard.",
  params: [{ name: "format", type: "enum", values: COPY_FORMATS, default: "plain" }],
  runs_in: "content",
  run: copy_url.run,
});
