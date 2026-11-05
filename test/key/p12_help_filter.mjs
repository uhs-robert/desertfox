// Key test case of the help Commands page filter. run.mjs calls run_cases with its helpers.
// The help page is an extension page, so the test reads it through the background's view list.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ run_case, send_keys, rdp, extension_id, expect, sleep }) {
  const help_view = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/help.html"))`;
  const read_page = (expression) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${help_view}; const doc = view.document; return ${expression}; })()`);
  const state = () => read_page(`({
    focused: doc.activeElement?.className ?? "",
    value: doc.querySelector(".oasisfox-help-filter")?.value ?? null,
    count: doc.querySelector(".oasisfox-help-filter-count")?.textContent ?? null,
    shown: [...doc.querySelectorAll(".oasisfox-help-command")].filter((card) => !card.hidden).length,
    current: doc.querySelector(".oasisfox-help-current h3")?.textContent ?? null,
  })`);

  await run_case("the help Commands filter: gi focuses it, typing narrows, Enter marks the first match, Escape leaves with the text kept", async () => {
    await send_keys("qh");
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      await sleep(250);
      ready = await read_page(`!!doc.querySelector("h1")`).catch(() => false);
    }
    expect(ready, "the help page never rendered");
    await read_page(`(view.location.hash = "#/commands", true)`);
    await sleep(800);
    const before = await state();
    expect(/^\d+ of \d+ commands$/.test(before.count ?? ""), `the count line before typing was "${before.count}"`);

    await send_keys("gi");
    await sleep(400);
    expect((await state()).focused === "oasisfox-help-filter", "gi did not focus the filter box");

    await send_keys("scroll.down");
    await sleep(400);
    const narrowed = await state();
    expect(narrowed.value === "scroll.down", `the box held "${narrowed.value}"`);
    expect(narrowed.shown >= 1 && narrowed.shown < before.shown, `typing left ${narrowed.shown} of ${before.shown} rows`);
    expect(narrowed.count === `${narrowed.shown} of ${before.count.split(" of ")[1]}`, `the count line was "${narrowed.count}" for ${narrowed.shown} rows`);

    await send_keys("-k", "Return");
    await sleep(400);
    expect((await state()).current !== null, "Enter did not mark the first match");

    // Escape is the content script's: it leaves insert mode and keeps the text.
    await send_keys("-k", "Escape");
    await sleep(400);
    const left = await state();
    expect(left.focused !== "oasisfox-help-filter", "Escape left the focus in the box");
    expect(left.value === "scroll.down", `Escape changed the text to "${left.value}"`);
  });
}
