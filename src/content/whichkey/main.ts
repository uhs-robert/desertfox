// The `whichkey` bundle: registers handlers. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, ReadRepeatPreview, WhichKeyPanel } from "../../shared/messages.ts";
import { MEDIA_PANEL_HANDLER, media_panel_admitted } from "./media_panel.ts";
import { hide_panel, show_panel } from "./panel.ts";
import { create_which_key_session } from "./session.ts";
import { create_which_key_timer } from "./timer.ts";
import { refused_as } from "../../shared/swallow.ts";

type WhichKeyWindow = { desertfox_host: BundleHostApi; desertfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

// What content.js sends on each prefix change: the setting values ride along because the timer here has no keymap.
type PrefixArgs = { prefix?: PendingPrefix; at_once?: boolean; delay_ms?: number; skip?: readonly string[] };

const session = create_which_key_session(
  async (mode, typed) => {
    const ask = <Answer>(message: ListKeys | ReadRepeatPreview) => browser.runtime.sendMessage(message) as Promise<Answer>;
    const [panel, repeat] = await Promise.all([ask<WhichKeyPanel>({ type: "list_keys", mode, prefix: typed }), refused_as(ask<string | undefined>({ type: "read_repeat_preview" }), undefined)]);
    return repeat === undefined ? panel : { ...panel, repeat };
  },
  show_panel,
  hide_panel,
);
const ignore_failure = () => undefined;

let delay_ms: number | undefined;
let skip: readonly string[] | undefined;
const follow_prefix = create_which_key_timer(
  () => delay_ms,
  (prefix, is_current, drawn) => (prefix ? void session.show_prefix_(prefix, is_current, drawn).catch(ignore_failure) : session.hide()),
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
  page.desertfox_host.register_handler_("help.whichkey", () => void session.show_manual_(page.desertfox_host.get_mode()).catch(ignore_failure));
  // Not a command: only the background asks for it, so there is no argument to check.
  page.desertfox_host.register_handler_(MEDIA_PANEL_HANDLER, () => {
    const mode = page.desertfox_host.get_mode();
    if (media_panel_admitted(mode, !!document.fullscreenElement)) void session.show_manual_(mode).catch(ignore_failure);
  });
}
