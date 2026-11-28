// A small stand-in for the chrome DOM the chrome hints feature reads: elements with boxes, shadow roots and listeners. `query` answers querySelectorAll by selector text.
import { key_event } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

export type Box = { left: number; top: number; width: number; height: number };
export type Handler = (event: FakeEvent & { target?: unknown }) => void;

// An element with the parts of the DOM the feature uses. `query` answers querySelectorAll by selector text.
export class Node {
  localName: string;
  id = "";
  hidden = false;
  disabled = false;
  visible = true;
  box: Box = { left: 0, top: 0, width: 0, height: 0 };
  children: Node[] = [];
  parentNode: Node | null = null;
  shadow: Node | null = null;
  shadowRoot: Node | null = null;
  // A closed shadow root of Firefox's own, which only chrome code reads.
  openOrClosedShadowRoot: Node | null = null;
  // Set on a shadow root: the element that holds it.
  host: Node | null = null;
  query: Record<string, Node[]> = {};
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  className = "";
  text = "";
  clicks = 0;
  commands = 0;
  ownerDocument: { getElementById(id: string): Node | null } | null = null;
  open = false;
  state = "closed";
  listeners = new Map<string, Set<Handler>>();
  #class_list: { contains(name: string): boolean } | undefined;
  constructor(local_name: string, props: Partial<Node> = {}) {
    this.localName = local_name;
    Object.assign(this, props);
  }
  get isConnected(): boolean {
    let node: Node | null = this;
    while (node?.parentNode ?? node?.host) node = node.parentNode ?? node.host;
    return node?.localName === "#root";
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text: string) {
    this.text = text;
  }
  get classList(): { contains(name: string): boolean } {
    return this.#class_list ?? { contains: (name: string) => this.className.split(/\s+/).includes(name) };
  }
  set classList(value: { contains(name: string): boolean }) {
    this.#class_list = value;
  }
  checkVisibility() {
    return this.visible;
  }
  getBoundingClientRect() {
    return this.box;
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  // A selector a test did not set: "*" gives every element below, a list of ids or tag names gives those that match one of them.
  querySelectorAll(selector: string): Node[] {
    if (this.query[selector]) return this.query[selector]!;
    const below = this.descendants();
    if (selector === "*") return below;
    return below.filter((node) => node.matches(selector));
  }
  querySelector(selector: string): Node | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  descendants(): Node[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  // Selectors of one compound each (a tag, an #id or a .class, a bare [attribute], a [type=...] and the :not([editable]) the feature uses), or a parent > child pair of them.
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const one = part.trim();
      const child = one.lastIndexOf(">");
      if (child >= 0) return this.matches(one.slice(child + 1)) && (this.parentNode?.matches(one.slice(0, child)) ?? false);
      if (one.startsWith("#")) return this.id === one.slice(1);
      if (one.startsWith(".")) return this.classList.contains(one.slice(1));
      const bare_attribute = /^\[([a-z-]+)\]$/.exec(one)?.[1];
      if (bare_attribute !== undefined) return this.attrs.has(bare_attribute);
      const tag = /^[a-z-]+/.exec(one)?.[0];
      const type = /\[type=([a-z]+)\]/.exec(one)?.[1];
      if (type !== undefined && this.getAttribute("type") !== type) return false;
      return tag === this.localName && !(one.includes(":not([editable])") && this.attrs.has("editable"));
    });
  }
  closest(selector: string) {
    for (let node: Node | null = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  contains(other: Node | null | undefined) {
    for (let node = other ?? null; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  append(...nodes: Node[]) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: Node[]) {
    for (const node of nodes.reverse()) {
      node.remove();
      node.parentNode = this;
      this.children.unshift(node);
    }
  }
  replaceChildren(...nodes: Node[]) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  attachShadow() {
    this.shadow = new Node("#shadow");
    return this.shadow;
  }
  click() {
    this.clicks++;
  }
  doCommand() {
    this.commands++;
  }
  addEventListener(type: string, handler: Handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(handler));
  }
  removeEventListener(type: string, handler: Handler) {
    this.listeners.get(type)?.delete(handler);
  }
  fire(type: string, event: Partial<FakeEvent> & { target?: unknown } = {}) {
    return this.dispatch(type, Object.assign(key_event("", { target: this }), event));
  }
  // Runs this node's listeners on the event itself, as the next target of one dispatch. A listener's stopImmediatePropagation skips the rest.
  dispatch(type: string, event: FakeEvent) {
    let stopped_here = false;
    const stop_now = () => {
      event.stopped = true;
      stopped_here = true;
    };
    Object.assign(event, { stopImmediatePropagation: stop_now });
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
      handler(event);
      if (stopped_here) break;
    }
    return event;
  }
  listener_total() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

