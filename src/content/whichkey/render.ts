// The panel's element tree, built in a given document with textContent only. The page bundle (panel.ts) and the browser module's which-key (browser_module/sources/whichkey.js) both draw with it, so the two panels match.

import type { WhichKeyPanel } from "../../shared/messages/content.ts";
import { choose_columns, fit_title } from "./layout.ts";

export type PanelFooter = readonly (readonly [key: string, word: string])[];

// Rows fill left to right, then down. `parts` go into the surface in order. The chip gets its text from `fit_chip` once it is in a document, because only a rendered chip can say whether it overflows.
export function render_panel(doc: Document, { rows, border, repeat }: Pick<WhichKeyPanel, "rows" | "border" | "repeat">, footer_keys: PanelFooter, viewport_height_px: number) {
  const element = (tag: string, class_name: string, text = "") => Object.assign(doc.createElement(tag), { className: class_name, textContent: text });
  const columns = choose_columns(rows.length, viewport_height_px);
  const list = element("div", "rows");
  list.style.gridTemplateColumns = `repeat(${columns}, auto)`;
  list.append(
    ...rows.map((row) => {
      const line = element("div", row.more ? "row group" : "row");
      line.title = row.description;
      line.append(element("span", "key", row.keys), element("span", "arrow", "➜"), element("span", "label", row.command));
      return line;
    }),
  );
  const footer = element("div", "footer");
  for (const [key, word] of footer_keys) footer.append(element("span", "", key), word);
  if (repeat !== undefined) {
    const line = element("div", "repeat");
    line.append(element("span", "", "."), repeat);
    footer.append(line);
  }
  const frame = element("div", `frame ${border}`);
  const body = element("div", "body");
  body.append(list, footer);
  frame.append(body);
  const title_bar = element("div", "title");
  const chip = element("div", "chip");
  title_bar.append(chip);
  return { parts: [title_bar, frame], chip, frame, columns };
}

// Returns how many groups the title dropped from its start.
export function fit_chip(chip: Element, title: readonly string[]): number {
  const { text, dropped } = fit_title(title, (candidate) => ((chip.textContent = candidate), chip.scrollWidth > chip.clientWidth));
  chip.textContent = text;
  return dropped;
}
