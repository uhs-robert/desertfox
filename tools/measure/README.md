# Size measurements

The scripts that produced the numbers in [`docs/firefox-behavior.md`](../../docs/firefox-behavior.md), "content.js size". Re-run them before raising the content.js guard past its present value, or the ceiling (see `AGENTS.md`, "Content script size"). They need `firefox` on the path. Run each from the repo root.

Scratch files (profiles, results) go to `$MEASURE_DIR`, default `/tmp/desertfox-measure`. Results are not committed. The scripts that install the extension read `dist/`, so run `just build` first. Each one drives headless Firefox over the debugger protocol (`test/key/rdp.mjs`) and prints or writes JSON.

| Script | Run | Measures | Output |
|---|---|---|---|
| `bench.mjs` | `node tools/measure/bench.mjs` | Compile time, per-sandbox heap and time to the key listener for padded copies of `dist/content.js` | `$MEASURE_DIR/bench/result.json` |
| `micro.mjs` | `node tools/measure/micro.mjs` | The compile-and-run table and the heap-per-sandbox table (300 sandboxes). Needs the profile and files that `bench.mjs` left in `$MEASURE_DIR/bench/run`, so run `bench.mjs` first | `$MEASURE_DIR/bench/micro.json` |
| `frames.mjs` | `node tools/measure/frames.mjs` | Load time and resident memory on pages with 200 subframes, with and without the extension | `$MEASURE_DIR/frames/result.json` |
| `heap.mjs` | `node tools/measure/heap.mjs` | Extension heap per subframe, from memory reports | `$MEASURE_DIR/frames/heap.json` |
| `tab.mjs` | `node tools/measure/tab.mjs` | The timeline of a switch to a loaded and a discarded tab, and `tabs.reload` and `tabs.warmup` on the neighbor | `$MEASURE_DIR/tab/result.json` |
| `p99_first_press.mjs` | see below | First and second press of `f` and `g`, and the early j on a slow-body page | `$MEASURE_DIR/fp/out.jsonl` |
| `p99_profile.mjs` | see below | `start()` and per-key time with real keys | `$MEASURE_DIR/fp/prof.jsonl` |
| `p96_hints_large.mjs` | see below, `KEY_TEST_PIECES=p96_hints_large` | Time from the `f` press to the first hint label on a page with 10,000 links and 10,000 plain divs, against a small-page control | `$MEASURE_DIR/hints_large/out.jsonl` |

## Rival benchmark

`just measure-rivals` runs `tools/measure/rivals/`: DesertFox from `dist/` and the pinned store builds of three rival extensions, each alone in a fresh headless Firefox profile, plus a no-extension baseline. It needs `firefox`, `unzip` and network. Settings by environment: `PAGES` (default `large,wiki,frames,frames0`), `RUNS` (timed runs per page and tool, default 8), `PASSES` (1 or 2, default 2).

| File | Role |
|---|---|
| `tools.mjs` | The pinned store builds (url, sha256, version, add-on id), the tool names and the page names, shared by the other scripts |
| `rivals.mjs` | Downloads each pinned xpi into its own empty directory and checks its sha256, version and id, saves the article page, runs every tool, then calls `analyze.mjs` |
| `run.mjs` | One tool in one fresh profile over the pages: load times, time from the hint key to the first label, memory of the page and extension processes |
| `framescript.js` | Runs in the page's content process: sends a trusted key and watches for hint labels, also inside closed shadow roots |
| `pages.mjs` | The pages: 20,000 elements, the saved article, 100 iframes, and the same page with none |
| `analyze.mjs` | Medians and ranges into `$MEASURE_DIR/rivals/out/tables.md`, for the pages that ran |

The article is a snapshot taken on the first run and reused after it. Delete `$MEASURE_DIR/rivals/pages` to take a new one. The run stops with an error if the policy-installed DesertFox cannot be removed.

Pages: `large` is 10,000 links and 10,000 divs, `wiki` is a saved long article with many links, `frames` has 100 same-origin iframes and `frames0` is its top page alone. Per-frame cost is `frames` minus `frames0`.

Results go to `$MEASURE_DIR/rivals`, never into the repo. Load times swing by tens of milliseconds when other work runs on the machine, so compare medians of several runs and passes. A system policy that force-installs DesertFox into every profile would bias the run, so `run.mjs` removes it before measuring and stops if it cannot. The probe reads hint labels inside closed shadow roots through a chrome frame script, which makes the tools comparable. Only labels in the top document are counted: a tool that draws labels inside iframes shows a low count on `frames`.

## Key-test pieces

`p99_first_press.mjs`, `p99_profile.mjs` and `p96_hints_large.mjs` are pieces for the headed key test, which needs a nested Hyprland session (see `test/key/README.md`). The harness only finds pieces named `p<number>_*.mjs` in `test/key/`. Copy the piece there for the run and delete the copy afterwards, so no throwaway piece is committed:

```bash
cp tools/measure/p99_first_press.mjs test/key/
KEY_TEST_PIECES=p99_first_press just key-test
rm test/key/p99_first_press.mjs
```

`p99_first_press.mjs` also uses the `/slow_body` route in `test/key/server.mjs`, which sends the head at once and holds the body for the `ms` query param.

`p99_profile.mjs` reads `window.__df_prof`, which no committed build sets. It needs a content.js instrumented to record `start()` and per-key times, about 500 B larger. That instrumentation was a throwaway patch and is not kept.
