// The pages run.mjs serves. `yt_embed` is the one page of the live-site check (PAGES=sites) served here. `large` has 20,000 elements (10,000 links and 10,000 divs), the size where hint collection cost shows. `wiki` is a saved long article with many links. `frames` has 100 same-origin iframes of 20 links each, and `frames0` is its top page alone, so (frames minus frames0) / 100 is the cost of one frame.
import { readFileSync } from "node:fs";

const pages_dir = `${process.env.RIVALS_DIR}/pages`;

// A target is any element with data-target. The frame script reads each target's rect and visibility, and match_labels.mjs maps hint labels to targets by position.
// The page is 20,000 px tall (about 29 viewports) with 16,000 filler elements, and scrolls to y=2000 on load, so the sticky header is stuck and every off-screen wrapper (at y=100 or y>=3500) lies outside the viewport.
// Each wrapper has zero size, so the target inside it is placed only by CSS: the case a "skip children of off-screen boxes" shortcut gets wrong.
// Targets sit 60 px apart where they share a lane, which match_labels.mjs relies on.
// The last child of each off-screen wrapper. Vimium C jumps to a pruned box's last child and tests that child, so a wrapper whose only child is the visible content is never pruned.
const tail = `<div style="height:10px"></div>`;
const box = (style, inner) => `<div style="position:absolute;${style}">${inner}</div>`;
const link = (target, style = "") => `<a href="/p?${target}" data-target="${target}" style="display:block;width:160px;height:30px;${style}">${target}</a>`;
const button = (target, style = "") => `<button data-target="${target}" style="display:block;width:160px;height:30px;${style}">${target}</button>`;
function coverage_body() {
  const parts = [
    `<div style="position:absolute;top:0;left:0;width:100%;height:20000px"><header style="position:sticky;top:0;height:40px;background:#ddd;z-index:5"><a href="/p?sticky_link" data-target="sticky_link" style="margin-left:400px">sticky_link</a></header></div>`,
    // Plain cases at fixed offsets in view.
    box("top:2080px;left:20px", link("plain_link")),
    box("top:2140px;left:20px", button("plain_button")),
    box("top:2200px;left:20px", `<input data-target="plain_input" value="plain_input" style="width:160px;height:30px">`),
    // Open dropdown: the wrapper is below the viewport and the open menu is pulled up into it.
    box("top:3500px;left:300px;width:0;height:0", box("top:-1400px;left:0", `${link("dropdown_item_1")}<div style="height:30px"></div>${link("dropdown_item_2")}`) + tail),
    // Tooltip: the wrapper is below the viewport and the tooltip is pulled up into it.
    box("top:3600px;left:600px;width:0;height:0", box("top:-1450px;left:0", link("tooltip_below")) + tail),
    // Tooltip: the wrapper is above the viewport and the tooltip is pushed down into it.
    box("top:100px;left:900px;width:0;height:0", box("top:2150px;left:0", link("tooltip_above")) + tail),
    // Modal and banner: fixed children of wrappers that are below the viewport.
    box("top:3700px;left:0;width:0;height:0", `<div style="position:fixed;top:260px;left:300px;width:200px;background:#eee">${link("modal_link")}<div style="height:30px"></div>${button("modal_button")}</div>${tail}`),
    box("top:3800px;left:0;width:0;height:0", `<div style="position:fixed;bottom:0;left:600px;width:200px;background:#fe8">${link("banner_link")}</div>${tail}`),
    // Filler that makes the page tall and element-heavy. Vimium C prunes off-screen boxes only past 15,000 elements on a page much taller than the viewport, and only if more than 12 elements survive in view, hence the on-screen filler.
    box("top:2400px;left:20px", Array.from({ length: 20 }, () => `<span style="display:block;height:3px"></span>`).join("")),
    box("top:6000px;left:0;width:100%", Array.from({ length: 16000 }, () => `<span style="display:block;height:3px"></span>`).join("")),
    // A control that is not visible, so a label on it is noise. A display:none control has no rect to match a label to, so there is none.
    box("top:3900px;left:20px", link("control_offscreen")),
  ];
  return `<!doctype html><title>coverage</title><body style="margin:0;height:20000px">${parts.join("")}<script>scrollTo(0, 2000)</script></body>`;
}

// The live YouTube player in a cross-site iframe, through YouTube's iframe API. The player frame runs in another process, so the page copies the player's state and volume onto the body, where the frame script reads them. The spacer gives the scroll check room to move.
function yt_embed_body() {
  return `<!doctype html><title>yt_embed</title><body><div style="display:flex;align-items:center;gap:20px;margin-top:100px"><div id="player"></div><a href="/p?beside_player">a link beside the player</a></div><div style="height:3000px"></div>
<script>
function onYouTubeIframeAPIReady() {
  const player = new YT.Player("player", { width: 640, height: 360, videoId: "jNQXAC9IVRw", playerVars: { origin: location.origin } });
  setInterval(() => {
    if (typeof player.getPlayerState !== "function") return;
    document.body.dataset.ytState = player.getPlayerState();
    document.body.dataset.ytVolume = player.isMuted() ? 0 : player.getVolume();
  }, 200);
}
</script><script src="https://www.youtube.com/iframe_api"></script></body>`;
}

const links = (count, tag) => Array.from({ length: count }, (_, i) => `<a href="/p?${tag}=${i}">link ${tag} ${i}</a> text <span>x</span>`).join("<br>");

export function page_body(name) {
  if (name === "large") {
    const parts = [];
    for (let i = 0; i < 10000; i++) parts.push(`<a href="/page?id=big_${i}">link ${i}</a><div>plain ${i}</div>`);
    return `<!doctype html><title>large</title><body>${parts.join("")}</body>`;
  }
  if (name === "wiki") return readFileSync(`${pages_dir}/wiki.html`);
  if (name === "frames" || name === "frames0") {
    const frame_count = name === "frames" ? 100 : 0;
    let body = `<!doctype html><title>frames</title><p>top</p>${links(5, "top")}`;
    for (let i = 0; i < frame_count; i++) body += `<iframe src="/frame?i=${i}" width="300" height="80"></iframe>`;
    return body;
  }
  if (name === "tab") return `<!doctype html><title>tab</title><body><p>tab</p></body>`;
  if (name === "coverage") return coverage_body();
  if (name === "yt_embed") return yt_embed_body();
  if (name === "frame") return `<!doctype html><title>f</title><body>${links(20, "f")}</body>`;
  return null;
}
