// The text the user sees, as one string, with a map from each character back to a DOM position.
// Block boundaries and line breaks become "\n". Runs of whitespace collapse as the page renders them.
// Text in fields, scripts, styles and hidden elements is left out: fields belong to insert mode.
// The walk follows the rendered order into open and closed shadow roots and into same-origin frames.

import { shadow_root_of } from "../shadow.ts";

// A tree the text lives in. A Range and a style rule each reach into one tree only.
export type TextTree = Document | ShadowRoot;

export type TextModel = {
  text: string;
  // Character index to a DOM position, and the other way. An empty line made by a <br> has no text node, so its position is the <br> in its parent.
  point_at_: (index: number) => DomPoint;
  index_of_: (node: Node, offset: number) => number | undefined;
  // Every tree with text in the model, in the order the text meets them.
  trees: TextTree[];
  // Shadow roots and frame documents the walk met that gave no text, so a later fill is not seen through `trees`. Never overlaps `trees`.
  empty_trees_: TextTree[];
  // Custom elements (a hyphen in the tag name) the walk met with no shadow root. One can attach a root later, and that fires no mutation. A plain element can too, and is left out: checking every element is the cost this list avoids.
  pending_hosts_: Element[];
  // Every frame element the walk met. A frame that loads or navigates later fires `load` on the element and no mutation in this tree.
  frames: Element[];
  // The characters from `from` up to `to`, cut where the text passes into another tree.
  tree_runs_: (from: number, to: number) => TreeRun[];
  // The first character of the `start_node` given to the build, or of the text after it. Undefined when no text follows it.
  start_index_: number | undefined;
  // True when the walk stopped at MAX_TEXT_CHARS, so the text is only the start of the page.
  truncated: boolean;
};

export type DomPoint = { node: Node; offset: number };
export type TreeRun = { tree: TextTree; from: number; to: number };

type Segment = { node: Text; first_index_: number; offsets: number[] };
type TreeStart = { index: number; tree: TextTree };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "TEMPLATE", "HEAD"]);
const MAX_FRAME_DEPTH = 4;
// A page with more text than this is searched only up to here. The string, the offsets and each scan grow with the text, and a tab that holds tens of millions of characters stalls.
export const MAX_TEXT_CHARS = 4_000_000;

const is_block = (style: CSSStyleDeclaration) => !style.display.startsWith("inline") && style.display !== "contents";

const is_frame = (element: Element) => element.localName === "iframe" || element.localName === "frame";

// Null for a frame from another origin: reading it throws, and its own content script covers it.
export function frame_document(element: Element): Document | null {
  if (!is_frame(element)) return null;
  try {
    return (element as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
}

// What an element shows in its place: a shadow host its shadow tree, a slot the nodes assigned to it or else its own children.
function rendered_children(element: Element): ArrayLike<Node> {
  const shadow = shadow_root_of(element);
  if (shadow) return shadow.childNodes;
  const assigned = element.localName === "slot" ? (element as HTMLSlotElement).assignedNodes() : [];
  return assigned.length > 0 ? assigned : element.childNodes;
}

export function build_text_model(root: Element = document.body, start_node?: Node): TextModel {
  const segments: Segment[] = [];
  const empty_lines = new Map<number, DomPoint>();
  const tree_starts: TreeStart[] = [];
  const trees = new Set<TextTree>();
  const met_trees = new Set<TextTree>();
  const frames: Element[] = [];
  const pending_hosts_: Element[] = [];
  let text = "";
  let last_block: Element | undefined;
  let after_space = true;
  let start_seen = false;
  let start_index_: number | undefined;
  let truncated = false;

  // The last blank before a line end is the line end, so a line never ends in a space.
  const end_line = () => {
    text = text.endsWith(" ") ? text.slice(0, -1) + "\n" : text + "\n";
    after_space = true;
  };

  // Runs just before the text of `node` is added at text.length.
  const note_text_of = (node: Node) => {
    if (start_seen) start_index_ ??= text.length;
    const tree = node.getRootNode() as TextTree;
    if (tree_starts.at(-1)?.tree !== tree) tree_starts.push({ index: text.length, tree });
    trees.add(tree);
  };

  const add_break = (br: Element) => {
    if (text !== "" && !text.endsWith("\n")) return end_line();
    if (text === "") return;
    note_text_of(br);
    empty_lines.set(text.length, { node: br.parentNode!, offset: Array.prototype.indexOf.call(br.parentNode!.childNodes, br) });
    text += "\n";
  };

  const add_text = (node: Text, block: Element, preformatted: boolean) => {
    const offsets: number[] = [];
    let piece = "";
    let blank_before: boolean = after_space;
    // `node.data` is a copy of the whole text on each read when the node is the page's, so a long text read per character fills the memory.
    const data = node.data;
    for (let offset = 0; offset < data.length; offset++) {
      if (text.length + piece.length >= MAX_TEXT_CHARS) {
        truncated = true;
        break;
      }
      const char = data[offset]!;
      const is_blank: boolean = /\s/.test(char) && !(preformatted && char === "\n");
      if (is_blank && !preformatted) {
        if (blank_before) continue;
        piece += " ";
      } else piece += char;
      blank_before = is_blank;
      offsets.push(offset);
    }
    if (piece === "") return;
    if (last_block !== undefined && block !== last_block && text !== "" && !text.endsWith("\n")) end_line();
    if (text.endsWith("\n")) {
      // A new line drops its leading blanks.
      const lead = piece.length - piece.trimStart().length;
      piece = piece.slice(lead);
      offsets.splice(0, lead);
      if (piece === "") return;
    }
    note_text_of(node);
    segments.push({ node, first_index_: text.length, offsets });
    text += piece;
    after_space = blank_before;
    last_block = block;
  };

  // `block` is the nearest block around the node in the rendered tree, so inline text in a shadow root stays on its host's line.
  const visit = (node: Node, block: Element, preformatted: boolean, frame_depth: number): void => {
    if (text.length >= MAX_TEXT_CHARS) {
      truncated = true;
      return;
    }
    if (node === start_node) start_seen = true;
    if (node.nodeType === TEXT_NODE) return add_text(node as Text, block, preformatted);
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as Element;
    if (SKIPPED.has(element.tagName) || (element as HTMLElement).isContentEditable) return;
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (element.tagName === "BR") return add_break(element);
    if (is_frame(element)) {
      // The frame is the block around its body, so its text starts and ends a line.
      const inner = frame_document(element);
      frames.push(element);
      if (inner) met_trees.add(inner);
      if (inner?.body && frame_depth < MAX_FRAME_DEPTH) visit(inner.body, element, false, frame_depth + 1);
      return;
    }
    const shadow = shadow_root_of(element);
    if (shadow) met_trees.add(shadow);
    else if (element.localName.includes("-")) pending_hosts_.push(element);
    const children = rendered_children(element);
    const inner_block = is_block(style) ? element : block;
    const inner_preformatted = style.whiteSpace.startsWith("pre");
    for (let index = 0; index < children.length; index++) visit(children[index]!, inner_block, inner_preformatted, frame_depth);
  };

  visit(root, root, false, 0);
  return {
    text,
    point_at_: (index) => empty_lines.get(index) ?? point_at_(segments, index),
    index_of_: (node, offset) => index_of_(segments, empty_lines, node, offset),
    trees: [...trees],
    empty_trees_: [...met_trees].filter((tree) => !trees.has(tree)),
    pending_hosts_,
    frames,
    tree_runs_: (from, to) => tree_runs_(tree_starts, from, to),
    start_index_,
    truncated,
  };
}

function tree_runs_(tree_starts: TreeStart[], from: number, to: number): TreeRun[] {
  const runs: TreeRun[] = [];
  tree_starts.forEach(({ index, tree }, at) => {
    const run = { tree, from: Math.max(from, index), to: Math.min(to, tree_starts[at + 1]?.index ?? to) };
    if (run.from < run.to) runs.push(run);
  });
  return runs;
}

const document_of = (tree: TextTree): Document => (tree.nodeType === DOCUMENT_NODE ? (tree as Document) : (tree as ShadowRoot).ownerDocument);

// A removed frame or shadow host takes its text off the page, and the model can no longer select it.
// Firefox cuts a content script off from a removed frame's objects, so any read of them throws.
function is_alive(tree: TextTree): boolean {
  try {
    return document_of(tree).defaultView !== null && (tree.nodeType === DOCUMENT_NODE || (tree as ShadowRoot).host.isConnected);
  } catch {
    return false;
  }
}

export const trees_alive = (model: TextModel): boolean => model.trees.every(is_alive);

// True when a custom element that had no shadow root at build time has one now, so its text is not in the model.
// A host of a removed or navigated frame is a dead wrapper in Firefox and throws on read. It counts as changed, so the model is read again.
export const host_gained_root = (model: TextModel): boolean =>
  model.pending_hosts_.some((host) => {
    try {
      return shadow_root_of(host) !== null;
    } catch {
      return true;
    }
  });

// Each document holds one selection, for itself and for the shadow roots inside it. A dead one is left out.
export const documents_of = (model: TextModel): Document[] => [...new Set(model.trees.filter(is_alive).map(document_of))];

function point_at_(segments: Segment[], index: number): DomPoint {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (segments[middle]!.first_index_ <= index) low = middle;
    else high = middle - 1;
  }
  const segment = segments[low]!;
  const offset = segment.offsets[Math.min(index - segment.first_index_, segment.offsets.length - 1)]!;
  return { node: segment.node, offset: Math.max(offset, 0) };
}

function index_of_(segments: Segment[], empty_lines: Map<number, DomPoint>, node: Node, offset: number): number | undefined {
  if (node.nodeType !== TEXT_NODE) {
    for (const [index, point] of empty_lines) if (point.node === node && point.offset === offset) return index;
    return undefined;
  }
  const segment = segments.find((candidate) => candidate.node === node);
  if (!segment) return undefined;
  const at = segment.offsets.findIndex((raw) => raw >= offset);
  return segment.first_index_ + (at < 0 ? segment.offsets.length - 1 : at);
}
