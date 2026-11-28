// The panel: one closed shadow root on the page, a floating frame with its title set into the top border (the title takes part in the width, up to the page cap), a row per key and a footer.
// Hovering a row shows what the command does.

import type { WhichKeyPanel } from "../../shared/messages/content.ts";
import { KEY_TEST_BUILD } from "../../shared/key_test_build.ts";
import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import { fit_chip, render_panel } from "./render.ts";
import { STYLE } from "./style.ts";

const FOOTER = [["ESC", "close"], ["←", "back"]] as const;

// A held group keeps its panel until Escape, and Backspace leaves the hold but keeps the group.
const HELD_FOOTER = [["ESC", "leave hold"], ["␣", "end hold"], ["←", "back"]] as const;

let surface: ReturnType<typeof create_surface> | undefined;

export function show_panel(panel: WhichKeyPanel): void {
  surface ??= create_surface("desertfox-whichkey", STYLE, LAYERS.which_key);
  const { parts, chip, frame, columns } = render_panel(document, panel, panel.held ? HELD_FOOTER : FOOTER, window.innerHeight);
  surface.text.className = "desertfox-whichkey";
  surface.text.replaceChildren(...parts);
  // The key test reads these attributes, because the shadow root is closed. A release build leaves them out: a page can read them.
  if (KEY_TEST_BUILD) surface.host.setAttribute("data-desertfox-whichkey", `${columns}:${panel.rows.length}`);
  mount_surface(surface.host);
  const dropped = fit_chip(chip, panel.title);
  if (!KEY_TEST_BUILD) return;
  // Numbers only: the group names are the user's, and a page script can read this host.
  surface.host.setAttribute("data-desertfox-whichkey-dropped", String(dropped));
  surface.host.setAttribute("data-desertfox-whichkey-width", String(frame.getBoundingClientRect().width));
}

export const hide_panel = (): void => surface?.host.remove();
