// The panel: one closed shadow root on the page, a floating frame with its title set into the top border, a row per key and a footer.
// Hovering a row shows what the command does.

import type { WhichKeyPanel } from "../../shared/messages.ts";
import { create_surface, SURFACE_DEFAULT_VARIABLES } from "../surface.ts";
import { choose_columns } from "./layout.ts";

const CHAMFER_PX = 8;
const chamfer = (cut: number) =>
  `polygon(${cut}px 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% calc(100% - ${cut}px), calc(100% - ${cut}px) 100%, ${cut}px 100%, 0 calc(100% - ${cut}px), 0 ${cut}px)`;

// The look follows the Oasis editor float: a thin tinted border, a filled title chip, yellow keys, blue groups.
// The two colors default here and a page-wide `--oasisfox-*` setting overrides them.
const STYLE = `
.oasisfox-whichkey {${SURFACE_DEFAULT_VARIABLES}
  --primary: var(--oasisfox-accent, #7fa3c9);
  --secondary: var(--oasisfox-secondary, #e6c87a);
  --border: color-mix(in srgb, var(--primary) 60%, var(--oasisfox-bg));
  --dim: color-mix(in srgb, var(--oasisfox-fg) 55%, var(--oasisfox-bg));
  position: fixed; right: 16px; bottom: 44px; max-width: calc(100vw - 32px);
  font: var(--oasisfox-font);
}
.frame { background: var(--border); padding: 1px; }
.body { box-sizing: border-box; background: var(--oasisfox-bg); color: var(--oasisfox-fg); padding: 14px 14px 8px; overflow: auto; max-height: calc(100vh - 98px); }
.round, .round .body { border-radius: var(--oasisfox-radius); }
.chamfer { clip-path: ${chamfer(CHAMFER_PX)}; }
.chamfer .body { clip-path: ${chamfer(CHAMFER_PX - 1)}; }
.title { position: absolute; left: 12px; top: -11px; padding: 0 4px; z-index: 1;
  background: linear-gradient(to bottom, transparent 11px, var(--oasisfox-bg) 11px, var(--oasisfox-bg) 12px, transparent 12px); }
.chip { background: var(--primary); color: var(--oasisfox-bg); font-weight: bold; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
.rows { display: grid; column-gap: 24px; }
.row { display: flex; height: 22px; line-height: 22px; white-space: nowrap; overflow: hidden; }
.key { color: var(--secondary); min-width: 3ch; }
.arrow { color: var(--dim); padding-right: 8px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.group .label { color: var(--primary); font-weight: bold; }
.footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--oasisfox-fg) 15%, var(--oasisfox-bg)); text-align: center; color: var(--dim); font-style: italic; }
.footer span { font-style: normal; color: var(--secondary); font-size: 0.8em; margin: 0 4px 0 14px; }`;

const FOOTER: readonly [key: string, word: string][] = [["ESC", "close"], ["←", "back"]];

let surface: ReturnType<typeof create_surface> | undefined;

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, class_name: string, text = ""): HTMLElementTagNameMap[Tag] {
  return Object.assign(document.createElement(tag), { className: class_name, textContent: text });
}

// Rows fill left to right, then down.
export function show_panel({ title, rows, border }: WhichKeyPanel): void {
  surface ??= create_surface("oasisfox-whichkey", STYLE);
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
  title_bar.append(element("div", "chip", title));
  surface.text.replaceChildren(title_bar, frame);
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-whichkey", `${columns}:${rows.length}`);
  document.documentElement.append(surface.host);
}

export const hide_panel = (): void => surface?.host.remove();
