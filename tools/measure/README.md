# Size measurements

The scripts that produced the numbers in [`docs/firefox-behavior.md`](../../docs/firefox-behavior.md), "content.js size". Re-run them before raising the content.js guard past its present value, or the ceiling (see `AGENTS.md`, "Content script size"). They need `firefox` on the path. Run each from the repo root.

Scratch files (profiles, results) go to `$MEASURE_DIR`, default `/tmp/desertfox-measure`. Results are not committed. The scripts that install the extension read `dist/`, so run `just build` first. Each one drives headless Firefox over the debugger protocol (`test/key/rdp.mjs`) and prints or writes JSON.

| Script | Run | Measures | Output |
|---|---|---|---|
| `bench.mjs` | `node tools/measure/bench.mjs` | Compile time, per-sandbox heap and time to the key listener for padded copies of `dist/content.js` | `$MEASURE_DIR/bench/result.json` |
| `micro.mjs` | `node tools/measure/micro.mjs` | The compile and run table only. Needs the profile and files that `bench.mjs` left in `$MEASURE_DIR/bench/run`, so run `bench.mjs` first | `$MEASURE_DIR/bench/micro.json` |
| `frames.mjs` | `node tools/measure/frames.mjs` | Load time and resident memory on pages with 200 subframes, with and without the extension | `$MEASURE_DIR/frames/result.json` |
| `heap.mjs` | `node tools/measure/heap.mjs` | Extension heap per subframe, from memory reports | `$MEASURE_DIR/frames/result.json` |
| `tab.mjs` | `node tools/measure/tab.mjs` | The timeline of a switch to a loaded and a discarded tab, and `tabs.reload` and `tabs.warmup` on the neighbor | `$MEASURE_DIR/tab/result.json` |
| `p99_first_press.mjs` | see below | First and second press of `f` and `g`, and the early j on a slow-body page | `$MEASURE_DIR/fp/out.jsonl` |
| `p99_profile.mjs` | see below | `start()` and per-key time with real keys | `$MEASURE_DIR/fp/prof.jsonl` |

`frames.mjs` and `heap.mjs` write the same result file, so keep one run's output before starting the other.

## Key-test pieces

`p99_first_press.mjs` and `p99_profile.mjs` are pieces for the headed key test, which needs a nested Hyprland session (see `test/key/README.md`). The harness only finds pieces named `p<number>_*.mjs` in `test/key/`. Copy the piece there for the run and delete the copy afterwards, so no throwaway piece is committed:

```bash
cp tools/measure/p99_first_press.mjs test/key/
KEY_TEST_PIECES=p99_first_press just key-test
rm test/key/p99_first_press.mjs
```

`p99_profile.mjs` reads `window.__df_prof`, which no committed build sets. It needs a content.js instrumented to record `start()` and per-key times, about 500 B larger. That instrumentation was a throwaway patch and is not kept.
