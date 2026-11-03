// The panel: one closed shadow root on the page, with a title and a row per key. Hovering a row shows what the command does.

import type { WhichKeyRow } from "../../shared/messages.ts";
import { create_surface, SURFACE_DEFAULT_VARIABLES } from "../surface.ts";
import { choose_columns } from "./layout.ts";

const STYLE = `
.oasisfox-whichkey {${SURFACE_DEFAULT_VARIABLES}
  position: fixed; right: 16px; bottom: 44px; box-sizing: border-box; padding: 8px 12px; overflow: auto;
  max-width: calc(100vw - 32px); max-height: calc(100vh - 96px);
  background: var(--oasisfox-bg); color: var(--oasisfox-fg);
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}
.title { font-weight: bold; padding-bottom: 4px; color: var(--oasisfox-accent, #8ec07c); }
.rows { display: grid; column-gap: 24px; }
.row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.key { color: var(--oasisfox-fg); display: inline-block; min-width: 3ch; }
.arrow { opacity: 0.6; padding: 0 6px; }
.more, .more .key { color: var(--oasisfox-accent, #8ec07c); }`;

let surface: ReturnType<typeof create_surface> | undefined;

const element = (class_name: string, text?: string) => Object.assign(document.createElement("div"), { className: class_name, textContent: text ?? "" });

// Rows fill left to right, then down.
export function show_panel(title: string, rows: WhichKeyRow[]): void {
  surface ??= create_surface("oasisfox-whichkey", STYLE);
  const columns = choose_columns(rows.length, window.innerHeight);
  surface.text.className = "oasisfox-whichkey";
  const list = element("rows");
  list.style.gridTemplateColumns = `repeat(${columns}, auto)`;
  list.append(
    ...rows.map((row) => {
      const line = element(row.more ? "row more" : "row");
      line.title = row.description;
      const keys = element("key", row.keys);
      line.append(keys, Object.assign(document.createElement("span"), { className: "arrow", textContent: "\u2192" }), row.command);
      return line;
    }),
  );
  surface.text.replaceChildren(element("title", title), list);
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-whichkey", `${columns}:${rows.length}`);
  document.documentElement.append(surface.host);
}

export const hide_panel = (): void => surface?.host.remove();
