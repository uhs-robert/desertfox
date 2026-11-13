// The `quality_probe` bundle. The background injects it into every frame at each navigation, where it used to inject the `quality` bundle. A frame with a video reports, and the background injects `quality.js` into that frame alone.

import type { QualityProbe, QualityVideoState } from "../../shared/quality.ts";
import { has_video_in } from "./find_video.ts";
import { create_probe } from "./probe.ts";

type ProbeWindow = QualityVideoState & { desertfox_quality_probe?: ReturnType<typeof create_probe> };
const probe_window = window as unknown as ProbeWindow;

probe_window.desertfox_quality_probe ??= create_probe({
  has_video: () => {
    try {
      return has_video_in(document);
    } catch {
      return false;
    }
  },
  address: () => location.href,
  report: (video) => {
    probe_window.desertfox_quality_video = video;
    void (browser.runtime.sendMessage({ type: "quality_probe", address: location.href } satisfies QualityProbe) as Promise<unknown>).catch(() => undefined);
  },
  // Media events do not bubble, but a capture listener on the document sees them.
  watch: (on_media) => {
    for (const type of ["loadstart", "loadedmetadata", "play"]) document.addEventListener(type, on_media, true);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
});
probe_window.desertfox_quality_probe.run();
