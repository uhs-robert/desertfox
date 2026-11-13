// Pages for the grab keys. Each page keeps its result in the DOM, so the content script world reads it.
export const DRAG_PAGES = {
  // A link drags with no draggable attribute.
  link: `
<a id="src" href="/drag?id=link_elsewhere" style="display:block;width:80px;height:40px;background:#9cf">link</a>
<div id="dst" style="width:200px;height:80px;margin-top:20px;background:#fc9">dst</div>
<script>
dst.addEventListener("dragover", (e) => e.preventDefault());
dst.addEventListener("drop", (e) => { e.preventDefault(); dst.textContent = "dropped"; });
</script>`,
  h5: `
<div id="src" draggable="true" style="width:80px;height:40px;background:#9cf">src</div>
<div id="dst" style="width:200px;height:80px;margin-top:20px;background:#fc9">dst</div>
<script>
const strict = location.search.includes("strict");
const log = (ev, e, extra = {}) => send("drag", { ev, trusted: e.isTrusted, types: e.dataTransfer ? [...e.dataTransfer.types] : null, ...extra });
src.addEventListener("dragstart", (e) => { log("dragstart", e); if (strict && !e.isTrusted) return; e.dataTransfer.setData("text/plain", "payload"); e.dataTransfer.effectAllowed = "move"; });
dst.addEventListener("dragenter", (e) => e.preventDefault());
dst.addEventListener("dragover", (e) => e.preventDefault());
dst.addEventListener("drop", (e) => {
  e.preventDefault();
  const data = e.dataTransfer.getData("text/plain");
  log("drop", e, { data });
  dst.textContent = strict && !e.isTrusted ? "rejected" : "dropped:" + data;
});
src.addEventListener("dragend", (e) => log("dragend", e));
</script>`,
  ptr: `
<style>.col{display:inline-block;vertical-align:top;width:150px;min-height:150px;margin:10px;background:#eee}.card{height:30px;margin:4px;background:#9cf;touch-action:none}</style>
<div id="a" class="col"><div id="c1" class="card">card1</div><div id="c2" class="card">card2</div></div><div id="b" class="col"></div>
<script>
const strict = location.search.includes("strict");
let dragged = null;
document.addEventListener("pointerdown", (e) => { if (strict && !e.isTrusted) return; if (e.target.classList.contains("card")) { dragged = e.target; try { dragged.setPointerCapture(e.pointerId); send("drag", { ev: "capture_ok" }); } catch (err) { send("drag", { ev: "capture_error", name: err.name }); } } });
document.addEventListener("pointermove", (e) => { if (dragged) dragged.style.opacity = "0.5"; });
document.addEventListener("pointerup", (e) => {
  if (!dragged) return;
  dragged.style.opacity = "";
  try { dragged.releasePointerCapture(e.pointerId); } catch {}
  const col = document.elementFromPoint(e.clientX, e.clientY)?.closest(".col");
  if (col) col.appendChild(dragged);
  dragged = null;
});
</script>`,
  sortable: `
<style>li{height:30px;margin:4px;background:#9cf;list-style:none}ul{width:200px;padding:0}</style>
<ul id="list"><li id="i1">one</li><li id="i2">two</li><li id="i3">three</li></ul>
<script src="/sortable.js"></script>
<script>
const fallback = location.search.includes("fallback");
window.sortable_instance = new Sortable(document.getElementById("list"), { forceFallback: fallback, animation: 0, fallbackTolerance: 0, onEnd: (e) => send("drag", { ev: "sortable_end", old_index: e.oldIndex, new_index: e.newIndex }) });
</script>`,
  range: `
<input id="r" type="range" min="0" max="100" value="0" style="width:300px;display:block">
<div id="track" style="position:relative;width:300px;height:20px;background:#ddd;margin-top:20px"><div id="thumb" style="position:absolute;left:0;width:20px;height:20px;background:#36c"></div></div>
<canvas id="cv" width="300" height="100" style="display:block;margin-top:20px;background:#eee"></canvas>
<script>
const strict = location.search.includes("strict");
let down = false, last_x = 0;
thumb.addEventListener("pointerdown", (e) => { if (strict && !e.isTrusted) return; down = true; last_x = e.clientX; });
document.addEventListener("pointermove", (e) => { if (!down) return; const left = Math.max(0, Math.min(280, parseFloat(thumb.style.left || "0") + e.clientX - last_x)); last_x = e.clientX; thumb.style.left = left + "px"; });
document.addEventListener("pointerup", () => { down = false; });
r.addEventListener("input", () => send("drag", { ev: "range_input", value: r.value }));
let drawing = false, points = 0;
cv.addEventListener("mousedown", () => { drawing = true; });
cv.addEventListener("mousemove", () => { if (drawing) { points++; cv.dataset.points = points; } });
cv.addEventListener("mouseup", () => { drawing = false; });
</script>`,
};
