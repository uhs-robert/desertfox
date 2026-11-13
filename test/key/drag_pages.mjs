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
  // Every block with a data-in attribute belongs to the draggable group, one per sign. The link, the button, the div and the child of the grab cursor box do not.
  group: `
<style>.blk{width:80px;height:20px;margin:2px;background:#ddd}</style>
<a id="plain_link" class="blk" href="/drag?id=link_elsewhere" style="display:block">link</a>
<button id="plain_button" class="blk" style="display:block">button</button>
<div id="plain_div" class="blk">div</div>
<div data-in id="grabbable" class="blk" draggable="true">draggable</div>
<div data-in id="cursor_box" class="blk" style="cursor:grab"><span id="inherits">child</span></div>
<div data-in class="blk" style="cursor:nw-resize">resize</div>
<div data-in class="blk" style="touch-action:none">touch</div>
<input data-in type="range" class="blk">
<div data-in class="blk" role="slider" aria-valuenow="3">slider</div>
<div data-in class="blk" role="scrollbar">scrollbar</div>
<div data-in class="blk" role="separator" aria-valuenow="5">separator</div>
<div data-in class="blk" aria-grabbed="false">grabbed</div>
<div data-in class="blk" aria-roledescription="sortable item">sortable</div>
<div data-in class="blk sortable-handle">handle</div>
<div data-in class="blk" data-rbd-drag-handle-draggable-id="x">rbd</div>`,
  // The shape of a video player's volume panel: a slider role on a div that a pointer drag moves.
  slider: `
<div id="vol" role="slider" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" tabindex="0" style="width:100px;height:20px;background:#ddd"></div>
<div id="dst" style="width:100px;height:20px;margin-left:200px;background:#fc9">dst</div>
<script>
let down = false;
vol.addEventListener("pointerdown", () => { down = true; });
document.addEventListener("pointermove", (e) => { if (down) vol.setAttribute("aria-valuenow", String(Math.round(e.clientX - vol.getBoundingClientRect().left))); });
document.addEventListener("pointerup", () => { down = false; });
</script>`,
  // A volume slider that reads the pointer position as its value (the YouTube case): the value is the pointer's x over the box, on press and on every move. The thumb starts right of the middle.
  abs: `
<div id="vol" role="slider" aria-valuenow="80" aria-valuemin="0" aria-valuemax="100" tabindex="0" style="width:100px;height:20px;background:#ddd"></div>
<script>
let down = false;
const set_from = (e) => { const box = vol.getBoundingClientRect(); vol.setAttribute("aria-valuenow", String(Math.round(Math.min(100, Math.max(0, e.clientX - box.left))))); };
vol.addEventListener("pointerdown", (e) => { down = true; set_from(e); });
document.addEventListener("pointermove", (e) => { if (down) set_from(e); });
document.addEventListener("pointerup", () => { down = false; });
</script>`,
  h5: `
<div id="src" draggable="true" style="width:80px;height:40px;background:#9cf">src</div>
<div id="dst" style="width:200px;height:80px;margin-top:20px;background:#fc9">dst</div>
<script>
const strict = location.search.includes("strict");
const log = (ev, e, extra = {}) => send("drag", { ev, trusted: e.isTrusted, types: e.dataTransfer ? [...e.dataTransfer.types] : null, ...extra });
src.addEventListener("dragstart", (e) => { log("dragstart", e); if (strict && !e.isTrusted) return; e.dataTransfer.setData("text/plain", "payload"); e.dataTransfer.effectAllowed = "move"; });
dst.addEventListener("dragenter", (e) => e.preventDefault());
dst.addEventListener("dragover", (e) => { e.preventDefault(); dst.dataset.y = String(Math.round(e.clientY)); });
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
  // Three swipe targets, one per swipe route. The scroll-snap box scrolls natively. The two carousels take a pointer sequence: they turn a slide when the drag passes 40% of the width (strict pages ignore an untrusted one) and count presses and releases, so a test sees a button left down. The link is a carousel whose slide would start a native drag if the route were html5.
  swipe: `
<style>.box{width:300px;height:100px;margin:10px;display:block;overflow:hidden;background:#eee}.snap{overflow-x:auto;scroll-snap-type:x mandatory;white-space:nowrap}.snap div{display:inline-block;width:300px;height:100px;scroll-snap-align:start}.slide{float:left;width:300px;height:100px}</style>
<div id="snap" class="box snap"><div style="background:#9cf">a</div><div style="background:#fc9">b</div><div style="background:#cf9">c</div></div>
<div id="car" class="box swiper"><div id="track" style="width:900px;transition:none"><div class="slide" style="background:#9cf">a</div><div class="slide" style="background:#fc9">b</div><div class="slide" style="background:#cf9">c</div></div></div>
<a id="link" class="box swiper" href="/drag?id=link_elsewhere"><div style="width:900px"><div class="slide" style="background:#9cf">a</div><div class="slide" style="background:#fc9">b</div><div class="slide" style="background:#cf9">c</div></div></a>
<script>
const strict = location.search.includes("strict");
document.addEventListener("dragstart", () => { document.body.dataset.dragstart = String(+(document.body.dataset.dragstart || 0) + 1); });
for (const box of [car, link]) {
  let from = null;
  box.dataset.index = "0";
  box.dataset.pressed = "0";
  box.dataset.downs = "0";
  box.dataset.ups = "0";
  box.addEventListener("pointerdown", (e) => { if (strict && !e.isTrusted) return; from = e.clientX; box.dataset.pressed = "1"; box.dataset.downs = String(+box.dataset.downs + 1); });
  document.addEventListener("pointerup", (e) => {
    if (from === null) return;
    const dx = e.clientX - from;
    from = null;
    box.dataset.pressed = "0";
    box.dataset.ups = String(+box.dataset.ups + 1);
    if (Math.abs(dx) > 120) box.dataset.index = String(Math.max(0, Math.min(2, +box.dataset.index + (dx < 0 ? 1 : -1))));
  });
}
</script>`,
  sortable: `
<style>li{height:30px;margin:4px;background:#9cf;list-style:none}ul{width:200px;padding:0}</style>
<ul id="list"><li id="i1">one</li><li id="i2">two</li><li id="i3">three</li></ul>
<script src="/sortable.js"></script>
<script>
const fallback = location.search.includes("fallback");
if (location.search.includes("marked")) for (const item of list.children) item.draggable = true;
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
