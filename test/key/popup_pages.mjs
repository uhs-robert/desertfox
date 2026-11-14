// Pages for the popup-in-a-frame case (#634). The top page holds one cross-origin frame and focuses it on load, as a calendar page does. With `_click` in the id it does not, and the test clicks the frame, so the frame is one the user entered and is not parked.
// The frame holds three popups that close on the way a site's popup does: when the focused link blurs, when the document gets a focusout, and when the window blurs.
// Each popup reports `popup_closed` with its name, so the case reads which ones closed.
export function popup_frames_page(id, port) {
  const frame = `<iframe id="cross" src="http://localhost:${port}/popup_frame?id=${id}_cross" style="display:block;width:300px;height:200px"></iframe>`;
  return { body: frame, head: id.includes("_click") ? "" : `<script>addEventListener("load", () => document.getElementById("cross").contentWindow.focus())</script>` };
}

export function popup_frame_page() {
  const popup = (name) => `<div id="popup_${name}" style="height:20px;background:#9cf">${name} popup</div>`;
  const body = `<a id="trigger" href="#">apps</a>${popup("element")}${popup("document")}${popup("window")}
<script>
const close_popup = (name) => { document.getElementById("popup_" + name).remove(); send("popup_closed", { name }); };
const trigger = document.getElementById("trigger");
addEventListener("focus", () => trigger.focus());
trigger.addEventListener("blur", () => close_popup("element"));
document.addEventListener("focusout", () => close_popup("document"));
addEventListener("blur", () => close_popup("window"));
</script>`;
  return { body, head: "" };
}
