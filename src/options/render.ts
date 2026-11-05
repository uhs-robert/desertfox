// Draws the options model with DOM calls only. Text goes in with textContent, never innerHTML.

import type { OptionsModel } from "./model.ts";

type Child = Node | string;

function el(tag: string, class_name: string | undefined, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (class_name) node.className = class_name;
  node.append(...children);
  return node;
}

export function render_options(root: HTMLElement, model: OptionsModel): void {
  const warning_heading = model.keymap_warning_count > 0 ? `Warnings (${model.keymap_warning_count} keymap)` : "Warnings";
  const page = el(
    "main",
    "oasisfox-options-page",
    el("h1", undefined, "OasisFox status"),
    el("h2", undefined, "Config source"),
    el("p", undefined, model.source_text),
    el("h2", undefined, "Settings"),
    el("table", undefined, ...model.settings.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, el("code", undefined, row.value)), el("td", "oasisfox-options-muted", row.tag ?? "")))),
    el("h2", undefined, warning_heading),
  );
  if (model.warnings.length === 0) page.append(el("p", "oasisfox-options-muted", "No warnings."));
  else page.append(el("ul", "oasisfox-options-warnings", ...model.warnings.map((warning) => el("li", undefined, warning))));
  page.append(
    el("h2", undefined, "Commands"),
    el("table", undefined, ...model.commands.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.id)), el("td", undefined, row.label), el("td", undefined, row.intent)))),
    el("h2", undefined, "Change the config"),
    el("p", undefined, "This page is read-only. Edit the config files, then:"),
    el("ol", undefined, ...model.rebuild_steps.map((step) => el("li", undefined, el("code", undefined, step)))),
  );
  root.replaceChildren(el("div", "oasisfox-options", page));
}
