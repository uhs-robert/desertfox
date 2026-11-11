// Key-test piece: profile content.js start and per-key work with real keys. It reads window.__df_prof, so it needs a content.js build instrumented to fill it. See README.md.
import { appendFileSync, mkdirSync } from "node:fs";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
mkdirSync(`${work}/fp`, { recursive: true });
export const areas = ["keys"];
const out = (row) => appendFileSync(`${work}/fp/prof.jsonl`, JSON.stringify(row) + "\n");
export async function run_cases({ run_case, open_page, press_keys, sleep, in_active_tab }) {
  const read = async () => JSON.parse(await in_active_tab("JSON.stringify(window.__df_prof)"));
  await run_case("profile start", async () => {
    for (let i = 0; i < 6; i++) {
      await open_page("page", `prof_start_${i}`, { new_tab: true });
      await sleep(200);
      const prof = await read();
      out({ label: "start", start_ms: prof.start_ms, start_at: prof.start_at, parse_ms: prof.parse_ms, reply_chars: prof.reply_chars, reply_at: prof.reply_at, install_ms: prof.install_ms, installed_at: prof.installed_at });
    }
  });
  await run_case("profile keys", async () => {
    await open_page("page", "prof_keys", { new_tab: true });
    await sleep(300);
    for (let i = 0; i < 20; i++) { await press_keys("-k", "F8"); await sleep(50); }
    for (let i = 0; i < 20; i++) { await press_keys("j"); await sleep(150); }
    for (let i = 0; i < 20; i++) { await press_keys("x"); await sleep(120); await press_keys("-k", "Escape"); await sleep(120); }
    const prof = await read();
    out({ label: "keys", key: prof.key.map(([k, ms]) => [k, +ms.toFixed(4)]), keyup: prof.keyup.map((ms) => +ms.toFixed(4)) });
  });
  await run_case("profile keys in a field", async () => {
    await open_page("field", "prof_field", { new_tab: true });
    await sleep(300);
    await press_keys("g"); await sleep(60); await press_keys("i"); await sleep(500);
    for (let i = 0; i < 20; i++) { await press_keys("a"); await sleep(50); }
    const prof = await read();
    out({ label: "field", key: prof.key.map(([k, ms]) => [k, +ms.toFixed(4)]), keyup: prof.keyup.map((ms) => +ms.toFixed(4)) });
    await press_keys("-k", "Escape"); await sleep(200);
  });
}
