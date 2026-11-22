// The Commands page: one card per command, grouped, with the advanced toggle.

import type { CommandRow, HelpModel, KeyRow } from "./model.ts";
import { key_caps } from "../shared/key_caps.ts";
import { ADVANCED_SUFFIX, PAGES } from "../shared/page/help_route.ts";
import { block_node, el } from "./dom.ts";
import { page_sections, section_heading } from "./sections.ts";

function key_list(rows: KeyRow[]): HTMLElement {
  const cell = el("div", "desertfox-help-keys");
  if (rows.length === 0) {
    const none = el("span", "desertfox-help-muted", "-");
    none.setAttribute("aria-label", "no keys");
    cell.append(none);
    return cell;
  }
  for (const row of rows) {
    const line = el("div", "desertfox-help-key-line", el("span", "desertfox-help-mode", row.mode), key_caps(row.keys));
    if (row.args) line.append(" ", el("span", "desertfox-help-muted", row.args));
    cell.append(line);
  }
  return cell;
}

function params_table(command: CommandRow): HTMLElement | string {
  if (command.params.length === 0) return el("span", "desertfox-help-muted", "no options");
  const head = el("tr", undefined, ...["option", "type", "default", "values", "flags"].map((name) => el("th", undefined, name)));
  const body = command.params.map((param) =>
    el("tr", undefined, ...[param.name, param.type, param.default, param.values, param.flags].map((text) => el("td", undefined, text))),
  );
  return el("table", "desertfox-help-params", head, ...body);
}

export const command_anchor = (id: string): string => `command-${id}`;

// The card color cycles over the groups, so a reader sees where one group ends. The stylesheet maps the number to a role color.
const GROUP_ACCENTS = 5;

function command_card(command: CommandRow, group_index: number): HTMLElement {
  const card = el(
    "section",
    "desertfox-help-command",
    el("div", "desertfox-help-command-head", el("h3", undefined, command.label, " ", el("code", "desertfox-help-muted", command.id)), key_list(command.keys)),
    el("p", undefined, command.intent),
    el("pre", "desertfox-help-usage", command.usage),
    params_table(command),
  );
  card.id = command_anchor(command.id);
  card.setAttribute("data-accent", String(group_index % GROUP_ACCENTS));
  return card;
}

// The toggle lives in the hash, so a reload, a link and the back button keep it. It shows the count, which the shown model no longer holds.
function advanced_toggle(advanced: boolean, count: number): HTMLElement {
  const button = el("button", "desertfox-help-advanced-toggle", advanced ? "Hide advanced commands" : `Show advanced commands (${count})`) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-pressed", String(advanced));
  button.addEventListener("click", () => {
    location.hash = PAGES.find((page) => page.id === "commands")!.hash + (advanced ? "" : ADVANCED_SUFFIX);
  });
  return el("p", undefined, button, " ", el("span", "desertfox-help-muted", "Advanced commands are for setup and debugging."));
}

export function commands_page(model: HelpModel, advanced: boolean, hidden_count: number): HTMLElement[] {
  const sections = page_sections("commands", model);
  return [
    el("p", undefined, "Every command DesertFox has. Run a command from the command line or with a key. Search this page with the browser's find (Ctrl+F)."),
    block_node(model.tip),
    ...(hidden_count > 0 || advanced ? [advanced_toggle(advanced, hidden_count)] : []),
    ...model.groups.flatMap((group, index) => [section_heading("commands", sections[index]!), ...group.commands.map((command) => command_card(command, index))]),
  ];
}
