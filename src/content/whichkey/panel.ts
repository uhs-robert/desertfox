// The panel: one closed shadow root on the page, a floating frame with its title set into the top border (the title takes part in the width, up to the page cap), a row per key and a footer.
// Hovering a row shows what the command does.

import type { WhichKeyPanel } from "../../shared/messages.ts";
import { KEY_TEST_BUILD } from "../../shared/key_test_build.ts";
import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import { choose_columns, fit_title } from "./layout.ts";
import { STYLE } from "./style.ts";

const FOOTER: readonly [key: string, word: string][] = [["ESC", "close"], ["←", "back"]];

let surface: ReturnType<typeof create_surface> | undefined;

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, class_name: string, text = ""): HTMLElementTagNameMap[Tag] {
  return Object.assign(document.createElement(tag), { className: class_name, textContent: text });
}

// Rows fill left to right, then down.
export function show_panel({ title, rows, border, repeat }: WhichKeyPanel): void {
  surface ??= create_surface("desertfox-whichkey", STYLE, LAYERS.which_key);
  const columns = choose_columns(rows.length, window.innerHeight);
  surface.text.className = "desertfox-whichkey";
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
  surface.text.replaceChildren(title_bar, frame);
  // The key test reads these attributes, because the shadow root is closed. A release build leaves them out: a page can read them.
  if (KEY_TEST_BUILD) surface.host.setAttribute("data-desertfox-whichkey", `${columns}:${rows.length}`);
  mount_surface(surface.host);
  // Only a rendered chip can say whether it overflows.
  const { text, dropped } = fit_title(title, (candidate) => ((chip.textContent = candidate), chip.scrollWidth > chip.clientWidth));
  chip.textContent = text;
  if (!KEY_TEST_BUILD) return;
  // Numbers only: the group names are the user's, and a page script can read this host.
  surface.host.setAttribute("data-desertfox-whichkey-dropped", String(dropped));
  surface.host.setAttribute("data-desertfox-whichkey-width", String(frame.getBoundingClientRect().width));
}

export const hide_panel = (): void => surface?.host.remove();
