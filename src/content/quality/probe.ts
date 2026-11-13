// The probe in one frame: tell the background once when this document holds a video, so the background loads the `quality` bundle here and in no other frame.

// A frame with no video looks again this often, for `PROBE_SPAN_MS`, in case the video came in a way no media event reports (inside a shadow root, or after a script built it).
export const PROBE_LOOK_MS = 2000;
export const PROBE_SPAN_MS = 10_000;

export type ProbeDeps = {
  // True when the document holds a video or a known site player, open shadow roots of custom elements included.
  has_video: () => boolean;
  address: () => string;
  // Tells the background and resolves with whether it loaded the bundle. `video` is what the probe found, which the bundle reads when it loads.
  report: (video: boolean) => Promise<boolean>;
  // Calls the function on a media event in the document, with whether the event came from a video element.
  watch: (on_media: (from_video: boolean) => void) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

// One probe per document however often the injection runs. The background loads the bundle on a report, and the probe counts a report only when the background says it did. A refusal (the rule is off) leaves the probe ready, so a later injection or media event at the same address reports again.
// A report with a video counts for its address (`seen_at`). A document with the bundle loaded and a new address (a `pushState`) reports at once, video or not, so the bundle starts the rule for the new page. The search for a video goes on after a report with none.
export function create_probe(deps: ProbeDeps) {
  let armed = false;
  let loaded = false;
  let seen_at: string | undefined;
  let told_at: string | undefined;
  let look_until = 0;
  let looking = false;
  let busy = false;
  let again = false;
  async function tell(video: boolean): Promise<void> {
    // A request that comes while a report is out is not lost: the check runs again when that report settles.
    if (busy) return void (again = true);
    busy = true;
    const address = deps.address();
    try {
      if (!(await deps.report(video))) return;
      loaded = true;
      told_at = address;
      // A report without a video clears the last address that had one, so a return to it reports again.
      seen_at = video ? address : undefined;
    } catch {
      // A report that failed to arrive counts as refused.
    } finally {
      busy = false;
      if (again) {
        again = false;
        check();
      }
    }
  }
  async function look_again(): Promise<void> {
    if (looking) return;
    looking = true;
    try {
      while (seen_at !== deps.address() && deps.now() < look_until) {
        await deps.sleep(PROBE_LOOK_MS);
        if (seen_at !== deps.address() && deps.has_video()) await tell(true);
      }
    } finally {
      looking = false;
    }
  }
  function check(): void {
    const address = deps.address();
    if (seen_at === address) return;
    if (deps.has_video()) return void tell(true);
    if (loaded && told_at !== address) void tell(false);
    look_until = deps.now() + PROBE_SPAN_MS;
    void look_again();
  }
  return {
    run(): void {
      if (!armed) {
        armed = true;
        deps.watch((from_video) => {
          if (from_video && seen_at !== deps.address()) void tell(true);
        });
      }
      check();
    },
  };
}
