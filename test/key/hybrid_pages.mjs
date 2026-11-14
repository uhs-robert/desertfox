// Pages for frame-focus-hybrid: a top page with one frame that takes the focus on load (or not), as a sign-in popup frame does.
// The id of the top page carries the frame kind after the page name, e.g. `p6_hybrid_load_focus`. The frame reports under `<id>_cross` (or `_same`), with the user activation it has at each focus event.
//   load_focus: a frame of another origin focuses a non-field container on load (the Google sign-in picker).
//   field:      a frame of another origin autofocuses a text field on load (a payment or chat field).
//   idle:       a frame of another origin that takes no focus on its own, for a click or Tab into it.
//   same:       the load_focus frame, same origin as the top page (the Docs-like case).
const KINDS = ["load_focus", "field", "idle", "same"];

export const hybrid_kind_of = (id) => KINDS.find((kind) => id.includes(`_${kind}`)) ?? "load_focus";

export function hybrid_frames_page(id, port) {
  const kind = hybrid_kind_of(id);
  const origin = kind === "same" ? "" : `http://localhost:${port}`;
  const frame_id = `${id}_${kind === "same" ? "same" : "cross"}`;
  const frame = `<iframe id="cross" src="${origin}/hybrid_frame?id=${frame_id}&kind=${kind}" style="display:block;width:300px;height:200px"></iframe>`;
  return { body: `<a id="top_link" href="/page?id=${id}_link">top link</a>${frame}`, head: "" };
}

export function hybrid_frame_page(kind) {
  const focus_on_load = kind === "field" ? `document.getElementById("name").focus()` : kind === "idle" ? "" : `document.getElementById("picker").focus()`;
  const body = `<div id="picker" tabindex="-1"><button id="close">close</button> <a id="learn" href="#more">learn more</a></div><input id="name" type="text">
<script>
const read = (name) => send(name, { has_been_active: navigator.userActivation.hasBeenActive, is_active: navigator.userActivation.isActive, active: document.activeElement?.id ?? "" });
addEventListener("focus", () => read("frame_focus"));
addEventListener("blur", () => read("frame_blur"));
document.getElementById("close").addEventListener("click", () => send("frame_closed"));
document.addEventListener("focusin", () => read("frame_focusin"));
addEventListener("load", () => { read("frame_load"); ${focus_on_load} });
</script>`;
  return { body, head: "" };
}
