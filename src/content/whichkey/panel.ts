// The panel: one closed shadow root on the page, a floating frame with its title set into the top border (the title takes part in the width, up to the page cap), a row per key and a footer.
// Hovering a row shows what the command does.

import type { WhichKeyPanel } from "../../shared/messages.ts";
import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import { choose_columns, fit_title } from "./layout.ts";

const CHAMFER_PX = 8;
const chamfer = (cut: number) =>
  `polygon(${cut}px 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% calc(100% - ${cut}px), calc(100% - ${cut}px) 100%, ${cut}px 100%, 0 calc(100% - ${cut}px), 0 ${cut}px)`;

// The look follows the Oasis editor float: a thin tinted border, a filled title chip, yellow keys, blue groups.
// --bg and --fg alias the page-wide `--oasisfox-*` settings, each with its default as a fallback.
export const STYLE = `
.oasisfox-whichkey {
  --bg: var(--oasisfox-bg-core, #0c0e13);
  --fg: var(--oasisfox-fg-core, #f5f5dc);
  --primary: var(--oasisfox-primary, #7fa3c9);
  --secondary: var(--oasisfox-secondary, #f0e68c);
  --border: color-mix(in srgb, var(--primary) 60%, var(--bg));
  --dim: color-mix(in srgb, var(--fg) 55%, var(--bg));
  position: fixed; right: 16px; bottom: 44px; max-width: calc(100vw - 32px);
  font: var(--oasisfox-font, 14px system-ui, sans-serif);
}
.frame { background: var(--border); padding: 1px; }
.body { box-sizing: border-box; background: var(--bg); color: var(--fg); padding: 14px 14px 8px; overflow: auto; max-height: calc(100vh - 98px); }
.round, .round .body { border-radius: var(--oasisfox-radius, 6px); }
.chamfer { clip-path: ${chamfer(CHAMFER_PX)}; }
.chamfer .body { clip-path: ${chamfer(CHAMFER_PX - 1)}; }
.title { position: relative; width: fit-content; height: 12px; margin: 0 12px -1px; padding: 0 4px; z-index: 1;
  background: linear-gradient(to bottom, transparent 11px, var(--bg) 11px, var(--bg) 12px, transparent 12px); }
.chip { box-sizing: border-box; max-width: calc(100vw - 64px); overflow: hidden; text-overflow: ellipsis; background: var(--primary); color: var(--bg); font-weight: bold; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
.rows { display: grid; column-gap: 24px; }
.row { display: flex; height: 22px; line-height: 22px; white-space: nowrap; overflow: hidden; }
.key { color: var(--secondary); min-width: 3ch; }
.arrow { color: var(--dim); padding-right: 8px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.group .label { color: var(--primary); font-weight: bold; }
.footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--fg) 15%, var(--bg)); text-align: center; color: var(--dim); font-style: italic; }
.footer span { font-style: normal; color: var(--secondary); font-size: 0.8em; margin: 0 4px 0 14px; }`;

const FOOTER: readonly [key: string, word: string][] = [["ESC", "close"], ["←", "back"]];

let surface: ReturnType<typeof create_surface> | undefined;

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, class_name: string, text = ""): HTMLElementTagNameMap[Tag] {
  return Object.assign(document.createElement(tag), { className: class_name, textContent: text });
}

// Rows fill left to right, then down.
export function show_panel({ title, rows, border }: WhichKeyPanel): void {
  surface ??= create_surface("oasisfox-whichkey", STYLE, LAYERS.which_key);
  const columns = choose_columns(rows.length, window.innerHeight);
  surface.text.className = "oasisfox-whichkey";
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
  for (const [key, word] of FOOTER) footer.append(element("span", "", key), word);
  const frame = element("div", `frame ${border}`);
  const body = element("div", "body");
  body.append(list, footer);
  frame.append(body);
  const title_bar = element("div", "title");
  const chip = element("div", "chip");
  title_bar.append(chip);
  surface.text.replaceChildren(title_bar, frame);
  // The key test reads these attributes, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-whichkey", `${columns}:${rows.length}`);
  mount_surface(surface.host);
  // Only a rendered chip can say whether it overflows.
  const { text, dropped } = fit_title(title, (candidate) => ((chip.textContent = candidate), chip.scrollWidth > chip.clientWidth));
  chip.textContent = text;
  // Numbers only: the group names are the user's, and a page script can read this host.
  surface.host.setAttribute("data-oasisfox-whichkey-dropped", String(dropped));
  surface.host.setAttribute("data-oasisfox-whichkey-width", String(frame.getBoundingClientRect().width));
}

export const hide_panel = (): void => surface?.host.remove();
