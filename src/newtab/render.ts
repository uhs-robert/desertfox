// The built-in page. Blank for now: the surface that the key scripts draw on.
export function render_new_tab(body: HTMLElement): void {
  const page = document.createElement("main");
  page.className = "oasisfox-newtab";
  body.prepend(page);
}
