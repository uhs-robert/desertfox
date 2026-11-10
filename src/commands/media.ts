import { define } from "../shared/registry/builtin.ts";
import { MEDIA_ACTIONS, MEDIA_VALUE_PATTERN } from "../shared/media.ts";
import { run_media, type MediaArgs, type MediaDeps } from "../background/media_actions.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";

const browser_media_deps: MediaDeps = {
  frame_ids: async (tab_id) => ((await browser.webNavigation.getAllFrames({ tabId: tab_id })) ?? []).map(({ frameId }) => frameId),
  // Document start runs the script at once, so a frame that is still loading answers instead of holding the key until it is idle.
  inject: async (tab_id, frame_id) => {
    await browser.tabs.executeScript(tab_id, { file: "media.js", frameId: frame_id, matchAboutBlank: true, runAt: "document_start" });
  },
  ask: (tab_id, frame_id, request) => browser.tabs.sendMessage(tab_id, request, { frameId: frame_id }),
  // Firefox 153 brought the standard API to desktop. The background page has the same engine as the pages, so it can ask for all of them. Node tools import this module too, where no HTMLVideoElement exists.
  can_picture_in_picture: () => "requestPictureInPicture" in (globalThis.HTMLVideoElement?.prototype ?? {}),
  toast: (ctx, message) => show_toast_on_tab(ctx, "media.act", message, "info"),
  answer_timeout_ms: 1500,
};

define("media.act", {
  name: "media",
  label: "Control media",
  intent:
    "Control the video and audio of the page. Play or pause, change the speed, volume or position, or toggle picture-in-picture. It acts on every playing video or audio in every frame, else on the largest visible video. For speed, volume and seek, up and down move one step (0.25x, 10% or 10 s), reset goes back to 1x, 100% or the start, a signed number moves by it and a bare number sets it. Without a value it shows the current one. A count prefix repeats an up or down step.",
  params: [
    // A strict string, not an enum: the line reads a required strict string from the first bare word and leaves `value` the subject, so `media speed 1.5` parses.
    { name: "action", type: "string", values: MEDIA_ACTIONS, strict: true },
    { name: "value", type: "string", main: true, pattern: MEDIA_VALUE_PATTERN, when: { action: ["speed", "volume", "seek"] } },
    { name: "times", type: "int", min: 1, default: 1, when: { value: ["up", "down"] }, description: "Move this many steps." },
  ],
  count: { param: "times" },
  needs: ["content"],
  runs_in: "background",
  run: (ctx, args) => run_media(browser_media_deps, ctx, args as MediaArgs),
});
