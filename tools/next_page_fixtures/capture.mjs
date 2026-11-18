// Saves live pages for the `]]` detector's suite as test/fixtures/next_page/<name>.json.gz, in a headless Firefox 1366 px wide.
// Usage: node tools/next_page_fixtures/capture.mjs <name> <url> [<name> <url>...]
// Then add or update the page's entry in labels.json by hand and run the suite.
import { launch, sleep } from "./bidi.mjs";
import { save_page } from "./scrub.mjs";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { matches_pattern } from "../../src/shared/match_pattern.ts";

// The item selector of the row that binds j on this address: the first matching row with a j bind, as the compiled rows resolve it. A row that binds j to anything but `page.item` (or binds no selector) gives no marks.
export function row_selector(url) {
  const row = DEFAULT_SITE_ROWS.find(({ row }) => row.bind?.j !== undefined && matches_pattern(row.site, url));
  const bind = [row?.row.bind?.j].flat()[0];
  return bind?.id === "page.item" ? bind.args.selector : undefined;
}

// Runs in the page. It keeps what the detector reads (see test/support/snapshot_page.ts for the shape) and drops every element with no box, no control and nothing kept inside. `mark_selector` is the item selector of the shipped row for this address, or null: a shown element it matches gets `m: 1`, the oracle a finder is tested against.
const save_script = (mark_selector) => `(() => {
  const MARK = ${JSON.stringify(mark_selector)};
  const ATTRS = ["rel", "href", "role", "aria-label", "aria-expanded", "aria-haspopup", "aria-controls", "aria-pressed", "aria-roledescription", "aria-modal", "title", "type", "value", "disabled", "onclick"];
  const NEVER_WEAK = new Set(["html", "body", "head", "script", "style", "option"]);
  const TEXT_TAGS = new Set(["p", "pre", "li"]);
  const CONTROL = "a[href], area[href], button, [role=button], [role=link], input, summary";
  const scrolls_sideways = (el, style) => el.clientWidth > 0 && (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 20 || /hidden|clip/.test(style.overflowX) && el.scrollWidth > 1.5 * el.clientWidth && el.children.length > 0 && el.clientWidth > 150);
  const save = (el) => {
    const shadow = el.openOrClosedShadowRoot ?? el.shadowRoot;
    const kids = [...el.children, ...(shadow ? shadow.children : [])].map(save).filter(Boolean);
    const tag = el.localName;
    const rendered = el.getClientRects().length > 0;
    const hidden = !rendered || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const rect = el.getBoundingClientRect();
    const box = rendered ? [rect.left + scrollX, rect.top + scrollY, rect.width, rect.height].map(Math.round) : null;
    const style = getComputedStyle(el);
    const sideways = scrolls_sideways(el, style);
    const pinned = style.position === "fixed" || style.position === "sticky";
    const control = el.matches(CONTROL);
    const parent = el.parentElement;
    const pointer = !NEVER_WEAK.has(tag) && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true" && style.cursor === "pointer" && (tag === "a" || !parent || getComputedStyle(parent).cursor !== "pointer");
    const rel = /\\b(next|prev)\\b/.test(el.getAttribute("rel") || "");
    const item_size = !hidden && box[2] >= 120 && box[3] >= 24;
    const media = tag === "video" || tag === "audio";
    const marked = MARK !== null && !hidden && el.matches(MARK);
    const text_length = TEXT_TAGS.has(tag) && !hidden ? (el.textContent || "").replace(/\\s+/g, " ").trim().length : 0;
    if (!kids.length && !control && !(pointer && !hidden) && !rel && !item_size && !sideways && !pinned && !media && !marked && !text_length && tag !== "html" && tag !== "body") return null;
    const node = { t: tag };
    const attrs = {};
    for (const name of ATTRS) { const value = el.getAttribute(name); if (value !== null) attrs[name] = name === "onclick" ? "" : value.slice(0, 160); }
    for (const { name, value } of el.attributes) if (name === "id" || name.startsWith("data-")) attrs[name] = value.slice(0, 160);
    const classes = (typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).filter(Boolean);
    if (classes.length) attrs.class = classes.join(" ");
    if (marked) node.m = 1;
    if (text_length) node.n = text_length;
    if (Object.keys(attrs).length) node.a = attrs;
    if (box) node.r = box;
    if (hidden && box) node.h = 1;
    if (sideways) node.x = 1;
    if (pinned) node.p = 1;
    if (pointer) node.k = 1;
    if (control || pointer) node.s = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200);
    if (kids.length) node.c = kids;
    return node;
  };
  return JSON.stringify({ view: { w: innerWidth, h: innerHeight, doc_h: document.documentElement.scrollHeight }, root: save(document.documentElement) });
})()`;

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error("usage: node tools/next_page_fixtures/capture.mjs <name> <url> [<name> <url>...]");
  process.exit(2);
}
const firefox = await launch({ port: Number(process.env.CAPTURE_PORT) || undefined });
try {
  for (let at = 0; at < pairs.length; at += 2) {
    const [name, url] = [pairs[at], pairs[at + 1]];
    await firefox.navigate(url);
    await sleep(7000);
    // A reader scrolls to the end before pressing ]], so lazy lists and load controls render first.
    for (let step = 0; step < 6; step++) {
      await firefox.evaluate("scrollTo(0, document.documentElement.scrollHeight)");
      await sleep(700);
    }
    await sleep(2000);
    const final_url = await firefox.evaluate("location.href");
    const selector = row_selector(final_url);
    const page = JSON.parse(await firefox.evaluate(save_script(selector ?? null)));
    save_page(name, page);
    console.log(`saved ${name} (${final_url}) marks: ${selector ?? "none"}`);
  }
} finally {
  await firefox.close();
}
