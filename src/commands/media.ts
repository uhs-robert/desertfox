import { define } from "../shared/registry/builtin.ts";
import type { MediaStep, Ping } from "../shared/messages.ts";
import { MEDIA_ACTIONS } from "../shared/media.ts";
import { MEDIA_VALUE_PATTERNS } from "../shared/media_values.ts";
import { create_media_reports, run_media, type MediaArgs, type MediaDeps } from "../background/media_actions.ts";
import { ask_quality_in_tab } from "../background/quality_levels.ts";
import { create_tab_media } from "../background/tab_media.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";

// The background's message listener hands each frame's pushed scan to this.
export const media_reports = create_media_reports();

// The background's message listener hands each frame's mode report to this.
export const tab_media = create_tab_media({
  // Read at call time: Node tools import this module, where there is no `browser`.
  storage: { get: (keys) => browser.storage.session.get(keys), set: (items) => browser.storage.session.set(items), remove: (keys) => browser.storage.session.remove(keys) },
  send_step: (tab_id, on, frame_id, from) => browser.tabs.sendMessage(tab_id, { type: "media", on, from } satisfies MediaStep, frame_id === undefined ? {} : { frameId: frame_id }),
  frame_alive: (tab_id, frame_id) => browser.tabs.sendMessage(tab_id, { type: "ping" } satisfies Ping, { frameId: frame_id }).then(Boolean),
  now: () => Date.now(),
});

const browser_media_deps: MediaDeps = {
  reports: media_reports,
  tab_media,
  // Document start runs the script at once, so a frame that is still loading reports instead of holding the key until it is idle.
  inject_all: async (tab_id) => (await browser.tabs.executeScript(tab_id, { file: "media.js", allFrames: true, matchAboutBlank: true, runAt: "document_start" })).length,
  ask: (tab_id, frame_id, request) => browser.tabs.sendMessage(tab_id, request, { frameId: frame_id }),
  quality: ask_quality_in_tab,
  // Firefox 153 brought the standard API to desktop. The background page has the same engine as the pages, so it can ask for all of them. Node tools import this module too, where no HTMLVideoElement exists.
  can_picture_in_picture: () => "requestPictureInPicture" in (globalThis.HTMLVideoElement?.prototype ?? {}),
  toast: (ctx, message) => show_toast_on_tab(ctx, "media.act", message, "info"),
  answer_timeout_ms: 1500,
};

define("media.act", {
  name: "media",
  label: "Control media",
  intent:
    "Control the video and audio of the page. Play or pause, change the speed, volume or position, toggle picture-in-picture, fullscreen, mute or loop, show the time, speed, quality and volume, pick the quality, or skip to the next or previous video. It acts on the video and audio that play with sound in every frame, else on all that play, else on the largest visible video. For speed, volume and seek, up and down move one step (0.25x, 10% or 10 s), reset goes back to 1x, 100% or the start, end goes to the end of the media, percent goes to the count as a percent of the media (50% is the middle), a signed number moves by it and a bare number sets it. Fullscreen shows the video with its site controls, and needs a key press in the page. Speed stays within 0.25x to 4x, volume within 0 to 100 and seek within the media: a value outside is set to the nearest end. Without a value it shows the current one. Quality takes max, min, auto (the site decides), a height such as 1080 or 1080p, or up or down one level, and without a value it lists the levels of the video with the active one marked. It drives the site player, which only YouTube and players that expose an hls.js instance as html5player.hlsobj offer, and refuses elsewhere. Skip takes next or previous (next by default) and needs a site player that offers it, which YouTube does. A count prefix repeats an up or down step. Captions toggles the default subtitle track of the video, else the first, or the site player's captions on YouTube, and refuses with none. Frame takes up or down, pauses and moves one frame (a thirtieth of a second) per count, and the frame rate is a guess. Enter starts the media mode on the page's main video, with no fullscreen, and refuses when the page has no video.",
  params: [
    // A strict string, not an enum: the line reads a required strict string from the first bare word and leaves `value` the subject, so `media speed 1.5` parses.
    { name: "action", type: "string", values: MEDIA_ACTIONS, strict: true },
    {
      name: "value",
      type: "string",
      main: true,
      pattern_arms: Object.entries(MEDIA_VALUE_PATTERNS).map(([action, pattern]) => ({ pattern, when: { action: [action] } })),
      when: { action: Object.keys(MEDIA_VALUE_PATTERNS) },
    },
    // Up and down repeat per count. A percent seek has no default, so it needs its count.
    { name: "times", type: "int", min: 1, default: [{ value: 1, when: { value: ["up", "down"] } }], when: { value: ["up", "down", "percent"] }, description: "Steps to move, or the percent to go to." },
  ],
  count: { param: "times" },
  modes: ["normal", "media"],
  needs: ["content"],
  bridge: true,
  runs_in: "background",
  run: (ctx, args) => run_media(browser_media_deps, ctx, args as MediaArgs),
});
