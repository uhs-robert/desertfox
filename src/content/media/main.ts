// The `media` bundle. The background injects it into every frame of the tab for each `media` command, then asks each frame to scan and the chosen frames to apply.

import type { MediaRequest } from "../../shared/media.ts";
import { apply_in_frame, media_in, scan_frame, visible_area } from "./frame_media.ts";
import type { FrameView, Player } from "./frame_media.ts";

type MediaWindow = { desertfox_media_ready?: true };
const media_window = window as unknown as MediaWindow;

const view: FrameView = {
  players: () => media_in(document).map((element) => ({ player: element as unknown as Player, area: element.localName === "video" ? visible_area(element, innerWidth, innerHeight) : 0 })),
  pip_element: () => document.pictureInPictureElement,
  exit_pip: () => document.exitPictureInPicture(),
};

// Each command injects the file again, so a second run must not add a second listener.
if (!media_window.desertfox_media_ready) {
  media_window.desertfox_media_ready = true;
  // The content script's own listener answers nothing to these types, so this one's answer is the reply.
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const request = raw as MediaRequest;
    if (request.type === "media_scan") return Promise.resolve(scan_frame(view));
    if (request.type === "media_apply") return apply_in_frame(view, request);
    return undefined;
  });
}
