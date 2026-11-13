// A page like a web mail app: the root does not scroll, and two panes inside it do. The big pane is the one the scroll keys pick.
// The filler gives the whole-page scan something to read. Run the result in the page with executeScript.
export const pane_page_script = (filler_count = 20000) => `(() => {
  document.documentElement.style.cssText = "height:100%;overflow:hidden";
  document.body.style.cssText = "height:100%;margin:0;overflow:hidden";
  const make = (id, height) => {
    const pane = document.createElement("div");
    pane.id = id;
    pane.style.cssText = "height:" + height + "px;overflow:auto";
    pane.innerHTML = '<div style="height:20000px"></div>';
    document.body.append(pane);
  };
  make("big-pane", 300);
  make("small-pane", 100);
  const filler = document.createElement("div");
  filler.style.cssText = "height:0;overflow:hidden";
  filler.innerHTML = "<span></span>".repeat(${filler_count});
  document.body.append(filler);
  return true;
})()`;
