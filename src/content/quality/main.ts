// The `quality` bundle. The background injects it into every frame of the tab for each quality request and for each navigation, which starts the `media_quality` rule. Each frame reports whether it has a site player, the background picks one frame and sends the request to it alone. Each run reports again and adds no second listener.

import type { QualityReport, QualityRequest, QualityRuleStart } from "../../shared/quality.ts";
import { apply_quality } from "./apply.ts";
import type { Driver } from "./driver.ts";
import { hls_driver } from "./hls.ts";
import type { HlsPage } from "./hls.ts";
import { create_rule } from "./rule.ts";
import { youtube_driver } from "./youtube.ts";
import type { YouTubePage } from "./youtube.ts";

type QualityWindow = { desertfox_quality_ready?: true; desertfox_quality_rule?: ReturnType<typeof create_rule>; wrappedJSObject: YouTubePage & HlsPage };
const quality_window = window as unknown as QualityWindow;

// What the background needs to pick one player: whether this frame has one, and whether it lists levels yet.
function report(): QualityReport {
  try {
    const driver = probe();
    return { type: "quality_report", player: Boolean(driver), ready: (driver?.levels().length ?? 0) > 0 };
  } catch {
    return { type: "quality_report", player: false, ready: false };
  }
}

// The drivers read the page's own objects, not the content script's view of them (Firefox hides a page's expando properties from it). Each is found by probing the page for its handle, so no host list exists.
function probe(): Driver | undefined {
  const page = quality_window.wrappedJSObject;
  return youtube_driver(page) ?? hls_driver(page);
}

// One rule per frame however often the file runs, so a second injection continues the first one's manual-choice state.
const rule = (quality_window.desertfox_quality_rule ??= create_rule({
  read_value: () => browser.runtime.sendMessage({ type: "read_media_quality" }).then((value: unknown) => String(value), () => "off"),
  probe,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
}));

if (!quality_window.desertfox_quality_ready) {
  quality_window.desertfox_quality_ready = true;
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const request = raw as QualityRequest | QualityRuleStart;
    if (request.type === "quality_rule") return void rule.start(request.navigated);
    if (request.type !== "quality_apply") return undefined;
    try {
      const driver = probe();
      const answer = driver && apply_quality(driver, request);
      // Only a choice that took counts: a refusal (the player has no levels yet) leaves the rule running.
      if (request.op === "set" && answer?.chosen !== undefined) rule.manual_choice();
      return answer && Promise.resolve(answer);
    } catch {
      // A page object that throws on a read counts as a page with no player.
      return undefined;
    }
  });
}

void browser.runtime.sendMessage(report()).catch(() => undefined);
