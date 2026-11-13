// The `quality` bundle. The background injects it into every frame of the tab for each quality request and for each navigation, which starts the `media_quality` rule. Each frame reports whether it has a site player and a video, the background picks one frame and sends the request to it alone, and answers a frame with a video with the rule for its address. Each run reports again and adds no second listener.

import type { QualityReport, QualityRequest, QualityVideoState } from "../../shared/quality.ts";
import { apply_quality } from "./apply.ts";
import type { Driver } from "./driver.ts";
import { hls_driver } from "./hls.ts";
import type { HlsPage } from "./hls.ts";
import { create_rule } from "./rule.ts";
import { youtube_driver } from "./youtube.ts";
import type { YouTubePage } from "./youtube.ts";

type QualityWindow = QualityVideoState & { desertfox_quality_ready?: true; desertfox_quality_address?: string; desertfox_quality_rule?: ReturnType<typeof create_rule>; wrappedJSObject: YouTubePage & HlsPage };
const quality_window = window as unknown as QualityWindow;

// What the background needs to pick one player: whether this frame has one, whether it lists levels yet, and whether it holds a video at all.
function report(): QualityReport {
  try {
    const driver = probe();
    return { type: "quality_report", player: Boolean(driver), ready: (driver?.levels().length ?? 0) > 0, has_video: has_media() };
  } catch {
    return { type: "quality_report", player: false, ready: false, has_video: false };
  }
}

// The probe (`probe_main.ts`) loads this bundle where it found a video, and leaves its finding in `desertfox_quality_video`, so the search inside shadow roots runs there and not here.
const has_media = (): boolean => {
  try {
    return Boolean(probe()) || quality_window.desertfox_quality_video === true || document.querySelector("video") !== null;
  } catch {
    return false;
  }
};

// The drivers read the page's own objects, not the content script's view of them (Firefox hides a page's expando properties from it). Each is found by probing the page for its handle, so no host list exists.
function probe(): Driver | undefined {
  const page = quality_window.wrappedJSObject;
  return youtube_driver(page) ?? hls_driver(page);
}

// One rule per frame however often the file runs, so a second injection continues the first one's manual-choice state.
const rule = (quality_window.desertfox_quality_rule ??= create_rule({
  report: () => (browser.runtime.sendMessage(report()) as Promise<string | undefined>).catch(() => undefined),
  has_media,
  probe,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
}));

if (!quality_window.desertfox_quality_ready) {
  quality_window.desertfox_quality_ready = true;
  // Media events do not bubble, but a capture listener on the document sees them. A video that comes later wakes the rule here with no timer running.
  for (const type of ["loadstart", "loadedmetadata", "play"]) document.addEventListener(type, () => rule.wake(), true);
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const request = raw as QualityRequest | { type: "tree_updated" };
    if (request.type === "tree_updated") return void rule.refresh();
    if (request.type !== "quality_apply") return undefined;
    try {
      const driver = probe();
      const answer = driver && apply_quality(driver, request);
      // Only a choice that took counts: a refusal (the player has no levels yet) leaves the rule running.
      if (request.op === "set" && answer?.chosen !== undefined) rule.manual_choice();
      return answer && Promise.resolve(answer);
    } catch {
      // A page object that throws counts as a page with no player.
      return undefined;
    }
  });
}

// A new address in this frame is a navigation, which ends a manual choice. A second run at the same address (the load finishing, the about:blank pass) leaves it standing.
const navigated = quality_window.desertfox_quality_address !== location.href;
quality_window.desertfox_quality_address = location.href;
void rule.start(navigated);
