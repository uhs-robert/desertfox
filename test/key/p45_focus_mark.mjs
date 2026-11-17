// The focus mark: ]l (and the other focus moves) draw the shared box around the focused element when the page hides its own focus style, and draw nothing when the page shows one. The box is the one `page.item` uses, in a closed shadow root that the extension's own world reads with openOrClosedShadowRoot. It must not outlive its target: blur, Escape, a mode change, a removed link, and two quick presses leave one box on the latest link.

export const areas = ["keys", "hints", "bundles"];

const LINKS = 6;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const open_links = async (id, focus_css) => {
    await open_page("controls", `fm_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(focus_css)};
      document.head.append(style);
      const list = document.createElement("div");
      list.innerHTML = ${JSON.stringify(Array.from({ length: LINKS }, (_, index) => `<a id="l${index}" href="#l${index}" style="display:block;width:200px;height:30px;margin:0 0 60px 20px">link ${index}</a>`).join(""))};
      document.body.prepend(list);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const HIDDEN = "a:focus, a:focus-visible { outline: none; }";
  const READ_BOXES = `(() => {
    const found = [];
    for (const child of document.documentElement.children) {
      const box = child.openOrClosedShadowRoot?.querySelector(".desertfox-item-box");
      if (!box || !child.isConnected || box.style.visibility === "hidden") continue;
      const rect = box.getBoundingClientRect();
      found.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    return found;
  })()`;
  const boxes = () => in_active_tab(READ_BOXES);
  const rect_of = (id) => in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const near = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1.5);
  const expect_one_box_on = (id, what) => poll_until(what, async () => { const drawn = await boxes(); return drawn.length === 1 && near(drawn[0], await rect_of(id)); });
  const expect_no_box = (what) => poll_until(what, async () => (await boxes()).length === 0);
  const expect_focus = (id) => poll_until(`focus on ${id}`, async () => (await in_active_tab("document.activeElement?.id ?? ''")) === id);

  await run_case("]l draws the box on the link when the page hides its focus outline, and ]l again moves it", async () => {
    await open_links("show", HIDDEN);
    await press_keys("]l");
    await expect_focus("l0");
    await expect_one_box_on("l0", "the box on the first link");
    await press_keys("]l");
    await expect_focus("l1");
    await expect_one_box_on("l1", "the box on the second link");
  });

  await run_case("the box follows a scroll", async () => {
    await open_links("scroll", HIDDEN);
    await press_keys("]l");
    await expect_one_box_on("l0", "the box on the first link");
    await in_active_tab("window.scrollBy(0, 30); 0");
    await expect_one_box_on("l0", "the box after a scroll");
  });

  await run_case("no box when the page shows its own focus style", async () => {
    await open_links("visible", "a:focus { outline: 3px solid red; }");
    await press_keys("]l");
    await expect_focus("l0");
    await sleep(600);
    expect((await boxes()).length === 0, "the box showed over the page's own outline");
  });

  await run_case("a page that marks focus by color counts as visible", async () => {
    await open_links("color", "a { outline: none; color: black; background: white; } a:focus { background: yellow; }");
    await press_keys("]l");
    await expect_focus("l0");
    await sleep(600);
    expect((await boxes()).length === 0, "the box showed over a background change");
  });

  await run_case("blur clears the box", async () => {
    await open_links("blur", HIDDEN);
    await press_keys("]l");
    await expect_one_box_on("l0", "the box on the first link");
    await in_active_tab("document.activeElement.blur(); 0");
    await expect_no_box("the box to clear on blur");
  });

  await run_case("Escape clears the box", async () => {
    await open_links("escape", HIDDEN);
    await press_keys("]l");
    await expect_one_box_on("l0", "the box on the first link");
    await press_keys("-k", "Escape");
    await expect_no_box("the box to clear on Escape");
  });

  await run_case("a mode change clears the box", async () => {
    await open_links("mode", HIDDEN);
    await press_keys("]l");
    await expect_one_box_on("l0", "the box on the first link");
    await press_keys("f");
    expect((await in_active_tab("document.activeElement?.id")) === "l0", "hint mode moved the focus, so the timer is not what clears the box");
    await expect_no_box("the box to clear in hint mode");
    await press_keys("-k", "Escape");
  });

  await run_case("a link that leaves the page takes the box with it", async () => {
    await open_links("removed", HIDDEN);
    await press_keys("]l");
    await expect_one_box_on("l0", "the box on the first link");
    await in_active_tab(`document.getElementById("l0").remove(); 0`);
    await expect_no_box("the box to clear when its link is gone");
  });

  await run_case("two quick ]l presses leave one box, on the latest link", async () => {
    await open_links("quick", HIDDEN);
    await press_keys("]l]l");
    await expect_focus("l1");
    await expect_one_box_on("l1", "one box on the second link");
    await sleep(400);
    const drawn = await boxes();
    expect(drawn.length === 1 && near(drawn[0], await rect_of("l1")), `after the dust settles: ${JSON.stringify(drawn)}`);
  });

  await run_case("a link in a frame gets no box", async () => {
    await open_links("frame", HIDDEN);
    await in_active_tab(`(() => {
      const frame = document.createElement("iframe");
      frame.id = "inner";
      frame.srcdoc = '<style>a:focus{outline:none}</style><a id="in" href="#in">framed</a>';
      frame.style.cssText = "display:block;width:300px;height:60px";
      document.body.append(frame);
      for (let index = 0; index < ${LINKS}; index++) document.getElementById("l" + index).remove();
      return true;
    })()`);
    await sleep(500);
    await press_keys("]l");
    await sleep(600);
    expect((await boxes()).length === 0, "a box drew for a link in a frame");
  });
}
