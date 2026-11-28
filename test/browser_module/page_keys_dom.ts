// A small DOM for the page keys frame script: elements with boxes in page pixels, a scroll offset that scrollIntoView moves, shadow roots and frames. `matches` and `closest` read the few selector shapes the frame script uses.

export type Box = { left: number; top: number; width: number; height: number };

const top_level_parts = (selector: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < selector.length; at++) {
    if (selector[at] === "(") depth++;
    else if (selector[at] === ")") depth--;
    else if (selector[at] === "," && depth === 0) {
      parts.push(selector.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts;
};

export class Page {
  scroll_y = 0;
  inner_height = 600;
  inner_width = 800;
  active: El | null = null;
  scrolls: { element: El; block: string }[] = [];
  selection_node: El | null = null;
  root = new El("html", {}, this);
  body = new El("body", {}, this);
  // The window of the page: the test sets it to what `content` is.
  view: unknown = null;
  // What the editing command answers: false makes the frame script write the range itself.
  exec_result = true;
  constructor() {
    this.root.append(this.body);
    this.root.connected = true;
  }
  add(...elements: El[]): void {
    this.body.append(...elements);
  }
}

export class El {
  children: El[] = [];
  parent: El | null = null;
  shadow: El | null = null;
  host: El | null = null;
  contentDocument: El | null = null;
  connected = false;
  visible = true;
  disabled = false;
  readOnly = false;
  focused = 0;
  blurred = 0;
  type = "";
  box: Box = { left: 0, top: 0, width: 100, height: 20 };
  innerText: string;
  style: Record<string, string> = { scrollMarginTop: "" };
  scrollHeight = 0;
  clientHeight = 0;
  clientTop = 0;
  isContentEditable = false;
  nodeType = 1;
  value = "";
  localName: string;
  attrs: Record<string, string>;
  page: Page | null;
  constructor(local_name: string, attrs: Record<string, string> = {}, page: Page | null = null, text = "") {
    this.localName = local_name;
    this.attrs = attrs;
    this.page = page;
    this.innerText = text;
    this.type = attrs["type"] ?? "";
  }
  get textContent(): string {
    return this.innerText;
  }
  get openOrClosedShadowRoot(): El | null {
    return this.shadow;
  }
  get shadowRoot(): El | null {
    return this.shadow;
  }
  get activeElement(): El | null {
    return null;
  }
  get isConnected(): boolean {
    let node: El = this;
    while (node.parent ?? node.host) node = (node.parent ?? node.host)!;
    return node.connected;
  }
  get ownerDocument(): { defaultView: unknown } {
    return { defaultView: this.page?.view ?? null };
  }
  get parentElement(): El | null {
    return this.parent && this.parent.localName !== "#shadow" ? this.parent : null;
  }
  append(...nodes: El[]): void {
    for (const node of nodes) {
      node.parent = this;
      node.page ??= this.page;
      this.children.push(node);
    }
  }
  attach_shadow(...nodes: El[]): El {
    const root = new El("#shadow", {}, this.page);
    root.host = this;
    root.append(...nodes);
    this.shadow = root;
    return root;
  }
  getRootNode(): { host: El | null } {
    let node: El = this;
    while (node.parent) node = node.parent;
    return { host: node.host };
  }
  querySelectorAll(_selector: string): El[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  checkVisibility(): boolean {
    for (let node: El | null = this; node; node = node.parent) if (!node.visible) return false;
    return true;
  }
  abs_top(): number {
    return this.box.top;
  }
  getBoundingClientRect() {
    const top = this.box.top - (this.page?.scroll_y ?? 0);
    return { top, left: this.box.left, bottom: top + this.box.height, right: this.box.left + this.box.width, width: this.box.width, height: this.box.height };
  }
  getClientRects() {
    return this.box.width > 0 && this.box.height > 0 ? [this.getBoundingClientRect()] : [];
  }
  focus(_options?: unknown): void {
    this.focused++;
    if (this.page) this.page.active = this;
  }
  blur(): void {
    this.blurred++;
    if (this.page?.active === this) this.page.active = null;
  }
  scrollIntoView(options: { block: string }): void {
    if (!this.page) return;
    this.page.scrolls.push({ element: this, block: options.block });
    const margin = parseFloat(this.style["scrollMarginTop"] || "0") || 0;
    const view = this.page.inner_height;
    this.page.scroll_y = options.block === "start" ? this.box.top - margin : options.block === "end" ? this.box.top + this.box.height - view : this.box.top + this.box.height / 2 - view / 2;
  }
  contains(other: El | undefined): boolean {
    for (let node: El | null | undefined = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    return top_level_parts(selector).some((part) => this.matches_one(part));
  }
  // One compound selector: a tag, attribute tests and :not(...) clauses, in the shapes the frame script uses.
  private matches_one(part: string): boolean {
    const compound = /^([a-z0-9]*)((?:\[[^\]]+\]|:not\([^)]*\)|:disabled)*)$/.exec(part);
    if (!compound) return false;
    const [, tag, rest] = compound;
    if (tag !== "" && tag !== this.localName) return false;
    for (const clause of rest!.match(/\[[^\]]+\]|:not\([^)]*\)|:disabled/g) ?? []) {
      if (clause.startsWith(":not(")) {
        if (this.matches_one(clause.slice(5, -1))) return false;
      } else if (clause === ":disabled") {
        if (!this.disabled) return false;
      } else {
        const [, name, value] = /^\[([^=\]]+)(?:=(.*))?\]$/.exec(clause)!;
        const wanted = value?.replace(/^"|"$/g, "");
        const given = this.attrs[name!];
        if (given === undefined || (wanted !== undefined && given !== wanted)) return false;
      }
    }
    return true;
  }
  closest(selector: string): El | null {
    for (let node: El | null = this; node; node = node.parent) {
      if (top_level_parts(selector).some((part) => (part.startsWith("header:not(") ? node!.localName === "header" && !node!.has_section_ancestor() : node!.matches(part)))) return node;
    }
    return null;
  }
  private has_section_ancestor(): boolean {
    for (let node = this.parent; node; node = node.parent) if (["article", "aside", "main", "nav", "section"].includes(node.localName)) return true;
    return false;
  }
}
