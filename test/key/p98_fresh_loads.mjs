// Timing only: 24 loads of a fresh page in one tab, to see how long the content script takes to read the page tree.
const FRESH_LOAD_COUNT = 24;

export const areas = ["caret"];

export async function run_cases({ setup, open_page, events, find_event, record }) {
  // A setup step, so a failed load is reported and the run goes on to the other pieces.
  await setup("time fresh loads", async () => {
    const tree_read_ms = [];
    for (let index = 0; index < FRESH_LOAD_COUNT; index++) {
      const id = `fresh_${String(index).padStart(2, "0")}`;
      const mark = events.length;
      await open_page("page", id, { new_tab: false });
      tree_read_ms.push(find_event(mark, (event) => event.type === "tree_read" && event.page_id === id).ms);
    }
    record("tree_read_ms", tree_read_ms);
    const sorted = [...tree_read_ms].sort((left, right) => left - right);
    record("tree_read_summary", { loads: sorted.length, min: sorted[0], median: (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2, max: sorted.at(-1) });
  });
}
