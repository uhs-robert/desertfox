// The panel: one closed shadow root on the page, with a row per key. Hovering a row shows what the command does.

import type { WhichKeyRow } from "../../shared/messages.ts";
import { create_surface, SURFACE_DEFAULT_VARIABLES } from "../surface.ts";
import { choose_layout } from "./layout.ts";

const STYLE = `
.oasisfox-whichkey {${SURFACE_DEFAULT_VARIABLES}
  position: fixed; box-sizing: border-box; padding: 8px 12px; overflow: auto;
  background: var(--oasisfox-bg); color: var(--oasisfox-fg);
  font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}
.oasisfox-whichkey.column { right: 16px; bottom: 44px; max-width: 40ch; max-height: calc(100vh - 96px); }
.oasisfox-whichkey.grid { left: 16px; right: 16px; bottom: 44px; display: grid; grid-template-columns: repeat(auto-fill, minmax(26ch, 1fr)); gap: 2px 16px; max-height: 40vh; }
.row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.key { color: var(--oasisfox-accent, #8ec07c); display: inline-block; min-width: 3ch; }`;

let surface: ReturnType<typeof create_surface> | undefined;

export function show_panel(rows: WhichKeyRow[]): void {
  surface ??= create_surface("oasisfox-whichkey", STYLE);
  const layout = choose_layout(rows.length, window.innerHeight);
  surface.text.className = `oasisfox-whichkey ${layout}`;
  surface.text.replaceChildren(
    ...rows.map((row) => {
      const line = document.createElement("div");
      line.className = "row";
      line.title = row.description;
      const keys = document.createElement("span");
      keys.className = "key";
      keys.textContent = row.keys;
      line.append(keys, row.command);
      return line;
    }),
  );
  // The key test reads this attribute, because the shadow root is closed.
  surface.host.setAttribute("data-oasisfox-whichkey", `${layout}:${rows.length}`);
  document.documentElement.append(surface.host);
}

export const hide_panel = (): void => surface?.host.remove();
