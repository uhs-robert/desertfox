// The text the user sees, as one string, with a map from each character back to a DOM position.
// Block boundaries and line breaks become "\n". Runs of whitespace collapse as the page renders them.
// Text in fields, scripts, styles and hidden elements is left out: fields belong to insert mode.

export type TextModel = {
  text: string;
  // Character index to a DOM position, and the other way. An empty line made by a <br> has no text node, so its position is the <br> in its parent.
  point_at: (index: number) => DomPoint;
  index_of: (node: Node, offset: number) => number | undefined;
};

export type DomPoint = { node: Node; offset: number };

type Segment = { node: Text; first_index: number; offsets: number[] };

const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "TEMPLATE", "HEAD"]);

const is_block = (element: Element) => {
  const display = getComputedStyle(element).display;
  return !display.startsWith("inline") && display !== "contents";
};

const is_hidden = (element: Element) => {
  const style = getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden";
};

export function build_text_model(root: Node = document.body): TextModel {
  const segments: Segment[] = [];
  const empty_lines = new Map<number, DomPoint>();
  let text = "";
  let last_block: Element | undefined;
  let after_space = true;

  // The last blank before a line end is the line end, so a line never ends in a space.
  const end_line = () => {
    text = text.endsWith(" ") ? text.slice(0, -1) + "\n" : text + "\n";
    after_space = true;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (SKIPPED.has(element.tagName) || (element as HTMLElement).isContentEditable || is_hidden(element)) return NodeFilter.FILTER_REJECT;
        return element.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (text !== "" && !text.endsWith("\n")) end_line();
      else if (text !== "") {
        empty_lines.set(text.length, { node: node.parentNode!, offset: Array.prototype.indexOf.call(node.parentNode!.childNodes, node) });
        text += "\n";
      }
      continue;
    }
    const parent = node.parentElement!;
    let block: Element = parent;
    while (!is_block(block) && block.parentElement) block = block.parentElement;
    const preformatted = getComputedStyle(parent).whiteSpace.startsWith("pre");
    const offsets: number[] = [];
    let piece = "";
    let blank_before: boolean = after_space;
    for (let offset = 0; offset < (node as Text).data.length; offset++) {
      const char = (node as Text).data[offset]!;
      const is_blank: boolean = /\s/.test(char) && !(preformatted && char === "\n");
      if (is_blank && !preformatted) {
        if (blank_before) continue;
        piece += " ";
      } else piece += char;
      blank_before = is_blank;
      offsets.push(offset);
    }
    if (piece === "") continue;
    if (last_block !== undefined && block !== last_block && text !== "" && !text.endsWith("\n")) end_line();
    if (text.endsWith("\n")) {
      // A new line drops its leading blanks.
      const lead = piece.length - piece.trimStart().length;
      piece = piece.slice(lead);
      offsets.splice(0, lead);
      if (piece === "") continue;
    }
    segments.push({ node: node as Text, first_index: text.length, offsets });
    text += piece;
    after_space = blank_before;
    last_block = block;
  }
  return { text, point_at: (index) => empty_lines.get(index) ?? point_at(segments, index), index_of: (node, offset) => index_of(segments, empty_lines, node, offset) };
}

function point_at(segments: Segment[], index: number): DomPoint {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (segments[middle]!.first_index <= index) low = middle;
    else high = middle - 1;
  }
  const segment = segments[low]!;
  const offset = segment.offsets[Math.min(index - segment.first_index, segment.offsets.length - 1)]!;
  return { node: segment.node, offset: Math.max(offset, 0) };
}

function index_of(segments: Segment[], empty_lines: Map<number, DomPoint>, node: Node, offset: number): number | undefined {
  if (node.nodeType !== Node.TEXT_NODE) {
    for (const [index, point] of empty_lines) if (point.node === node && point.offset === offset) return index;
    return undefined;
  }
  const segment = segments.find((candidate) => candidate.node === node);
  if (!segment) return undefined;
  const at = segment.offsets.findIndex((raw) => raw >= offset);
  return segment.first_index + (at < 0 ? segment.offsets.length - 1 : at);
}
