// The probe in one frame: tell the background once when this document holds a video, so the background loads the `quality` bundle here and in no other frame.

// A frame with no video looks again this often, for `PROBE_SPAN_MS`, in case the video came in a way no media event reports (inside a shadow root, or after a script built it).
export const PROBE_LOOK_MS = 2000;
export const PROBE_SPAN_MS = 10_000;

export type ProbeDeps = {
  // True when the document holds a video, open shadow roots included.
  has_video: () => boolean;
  address: () => string;
  // Tells the background. `video` is what the probe found, which the bundle reads when it loads.
  report: (video: boolean) => void;
  // Calls the function on a media event in the document.
  watch: (on_media: () => void) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

// One probe per document however often the injection runs. It reports once per address: a second run at the same address (the load finishing, the about:blank pass) adds nothing, and a run at a new address (a `pushState` in a document that already reported) reports again, so the loaded bundle starts the rule for the new page.
export function create_probe(deps: ProbeDeps) {
  let armed = false;
  let reported_at: string | undefined;
  let look_until = 0;
  let looking = false;
  const send = (video: boolean): void => {
    reported_at = deps.address();
    deps.report(video);
  };
  async function look_again(): Promise<void> {
    if (looking) return;
    looking = true;
    try {
      while (reported_at === undefined && deps.now() < look_until) {
        await deps.sleep(PROBE_LOOK_MS);
        if (reported_at === undefined && deps.has_video()) send(true);
      }
    } finally {
      looking = false;
    }
  }
  return {
    run(): void {
      if (!armed) {
        armed = true;
        deps.watch(() => {
          if (reported_at === undefined) send(true);
        });
      }
      if (reported_at !== undefined) {
        // The bundle is loaded here and decides for the new page, so it needs the news even from a page with no video.
        if (reported_at !== deps.address()) send(deps.has_video());
        return;
      }
      if (deps.has_video()) return send(true);
      look_until = deps.now() + PROBE_SPAN_MS;
      void look_again();
    },
  };
}
