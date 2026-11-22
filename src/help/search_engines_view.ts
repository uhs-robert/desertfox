// The Search Engines page: the guide, then every resolved engine.

import type { Block } from "./blocks.ts";
import type { EngineRow, HelpModel } from "./model.ts";
import { block_node, el, page_link } from "./dom.ts";
import { GUIDE_SUBSECTION_LEVEL, page_sections, section_heading } from "./sections.ts";

export const engine_anchor = (name: string): string => `engine-${name}`;

const file_name = (path: string): string => path.split("/").pop() ?? path;

function engine_row(engine: EngineRow, show_files: boolean): HTMLElement {
  const name = el("td", undefined, engine.name);
  if (engine.needs) name.append(" ", el("span", "desertfox-help-badge", `needs ${engine.needs}`));
  if (engine.fallback) name.append(" ", el("span", "desertfox-help-badge", `falls back to ${engine.fallback}`));
  if (show_files) {
    for (const file of engine.files) {
      const badge = el("span", "desertfox-help-badge", file_name(file));
      badge.title = file;
      name.append(" ", badge);
    }
  }
  const keys = el("td", undefined, ...engine.keys.flatMap((sequence) => [el("kbd", undefined, sequence), " "]));
  const host = el("summary", undefined, engine.host);
  host.title = engine.url;
  const full = el("div", "desertfox-help-muted", engine.url, ...engine.origins.map((line) => el("div", undefined, line)));
  const row = el("tr", undefined, name, el("td", undefined, engine.label), keys, el("td", undefined, el("details", undefined, host, full)));
  row.id = engine_anchor(engine.name);
  return row;
}

function engine_table(engines: EngineRow[]): HTMLElement {
  if (engines.length === 0) return el("p", "desertfox-help-muted", "No engines yet. Add one on the ", page_link("Settings", "settings"), " page.");
  const first_file = engines[0]!.files[0];
  const one_file = first_file !== undefined && engines.every((engine) => engine.files.length === 1 && engine.files[0] === first_file);
  const head = el("tr", undefined, ...["Name", "What it searches", "Keys", "Address"].map((name) => el("th", undefined, name)));
  const table = el("table", "desertfox-help-engines", head, ...engines.map((engine) => engine_row(engine, !one_file)));
  if (!one_file) return table;
  return el("div", undefined, el("p", "desertfox-help-muted", `Set by the file ${first_file}`), table);
}


// The guide's level-3 headings and the engines table are the Search Engines sections. The sole level-2 heading in the guide is a wrapper, so it gets no entry.
export function search_engines_page(guide: Block[], model: HelpModel): HTMLElement[] {
  const sections = [...page_sections("search-engines", model, guide)];
  const body = guide.map((block) => {
    if (block.kind !== "heading" || block.level !== GUIDE_SUBSECTION_LEVEL) return block_node(block);
    return section_heading("search-engines", sections.shift()!, GUIDE_SUBSECTION_LEVEL);
  });
  return [...body, section_heading("search-engines", sections.shift()!), engine_table(model.engines)];
}
