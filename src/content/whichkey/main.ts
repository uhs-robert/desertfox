// The `whichkey` bundle: registers handlers. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, ReadRepeatPreview, WhichKeyPanel } from "../../shared/messages.ts";
import { MEDIA_PANEL_HANDLER, media_panel_admitted } from "./media_panel.ts";
import { create_arrival_guard } from "./arrival.ts";
import { hide_panel, show_panel } from "./panel.ts";
import { relay } from "../relay.ts";
import { create_which_key_session } from "./session.ts";
import { create_which_key_timer } from "./timer.ts";
import { refused_as, warn_and_go } from "../../shared/swallow.ts";

type WhichKeyWindow = { desertfox_host: BundleHostApi; desertfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

// What content.js sends on each prefix change: the setting values ride along because the timer here has no keymap.
type PrefixArgs = { prefix?: PendingPrefix; at_once?: boolean; delay_ms?: number; skip?: readonly string[] };

// The top frame draws the panel, so a panel for a subframe's keys sits where the user looks. Each message carries a count, because two relays can overtake each other.
let relayed_seq = 0;
let relayed_open = false;
const draw = (panel: WhichKeyPanel): void => {
  if (window === window.top) return show_panel(panel);
  relayed_open = true;
  const mine = ++relayed_seq;
  // A top frame that does not answer leaves the panel here, unless a newer draw or an erase came since.
  void relay("top", "whichkey.draw", { panel, seq: mine }).then((shown) => shown || mine !== relayed_seq || show_panel(panel));
};
const erase = (): void => {
  hide_panel();
  if (!relayed_open) return;
  relayed_open = false;
  void relay("top", "whichkey.erase", { seq: ++relayed_seq });
};

const session = create_which_key_session(
  async (mode, typed) => {
    const ask = <Answer>(message: ListKeys | ReadRepeatPreview) => browser.runtime.sendMessage(message) as Promise<Answer>;
    const [panel, repeat] = await Promise.all([ask<WhichKeyPanel>({ type: "list_keys", mode, prefix: typed }), refused_as(ask<string | undefined>({ type: "read_repeat_preview" }), undefined)]);
    return repeat === undefined ? panel : { ...panel, repeat };
  },
  draw,
  erase,
);
let delay_ms: number | undefined;
let skip: readonly string[] | undefined;
const follow_prefix = create_which_key_timer(
  () => delay_ms,
  (prefix, is_current, drawn) => (prefix ? void session.show_prefix_(prefix, is_current, drawn).catch(warn_and_go("whichkey.show_prefix")) : session.hide()),
  () => skip,
);

// A second run would register a second copy of the handler.
if (!page.desertfox_whichkey_ready) {
  page.desertfox_whichkey_ready = true;
  page.desertfox_host.register_handler_("whichkey", (args) => {
    const call = args as PrefixArgs;
    ({ delay_ms, skip } = call);
    follow_prefix(call.prefix, call.at_once);
  });
  // Not commands: only the background relays them, from a subframe's bundle.
  const arrived = create_arrival_guard();
  page.desertfox_host.register_handler_("whichkey.draw", (args) => void (arrived(args.from_frame, args.seq) && show_panel(args.panel as WhichKeyPanel)));
  page.desertfox_host.register_handler_("whichkey.erase", (args) => void (arrived(args.from_frame, args.seq) && hide_panel()));
  page.desertfox_host.register_handler_("help.whichkey", () => void session.show_manual_(page.desertfox_host.get_mode()).catch(warn_and_go("whichkey.show_manual")));
  // Not a command: only the background asks for it, so there is no argument to check.
  page.desertfox_host.register_handler_(MEDIA_PANEL_HANDLER, () => {
    const mode = page.desertfox_host.get_mode();
    if (media_panel_admitted(mode, !!document.fullscreenElement)) void session.show_manual_(mode).catch(warn_and_go("whichkey.media_panel"));
  });
}
