// The `media` bundle. The background asks each frame of a tab for its scan and injects this bundle by frame id into the frames that have no listener. It then asks the chosen frames to apply.

import { youtube_player } from "../quality/youtube.ts";
import type { YouTubePage } from "../quality/youtube.ts";
import type { MediaRequest } from "../../shared/media.ts";
import { enter_fullscreen, leave_fullscreen } from "./fullscreen.ts";
import { apply_in_frame, media_in, scan_frame, visible_area } from "./frame_media.ts";
import type { FrameView, Player } from "./frame_media.ts";

type MediaWindow = { desertfox_media_ready?: true; desertfox_pin?: WeakRef<Element>; wrappedJSObject: YouTubePage };
const media_window = window as unknown as MediaWindow;

const view: FrameView = {
  players: () => media_in(document).map((element) => ({ player: element as unknown as Player, area: element.localName === "video" ? visible_area(element, innerWidth, innerHeight) : 0, pinned_: element === media_window.desertfox_pin?.deref() })),
  site_player: () => youtube_player(media_window.wrappedJSObject),
  site_controls: (player) => !!document.getElementById("movie_player")?.contains(player as unknown as Node),
  pip_element: () => document.pictureInPictureElement,
  exit_pip: () => document.exitPictureInPicture(),
  fullscreen_element: () => document.fullscreenElement,
  toggle_fullscreen: (player) => (document.fullscreenElement ? leave_fullscreen() : enter_fullscreen(player as unknown as Element)),
};

// A second injection (two keys pressed before the first listener was up) must not add a second listener.
if (!media_window.desertfox_media_ready) {
  media_window.desertfox_media_ready = true;
  // The content script's own listener answers nothing to this type, so this one's answer is the reply.
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const request = raw as MediaRequest;
    if (request.type === "media_scan") return Promise.resolve(scan_frame(view));
    if (request.type === "media_apply") return apply_in_frame(view, request);
    return undefined;
  });
}
