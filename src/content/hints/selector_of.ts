// The shortest CSS selector that matches one element, for the copy_selector action.

type Node = {
  localName: string;
  id: string;
  classList: ArrayLike<string>;
  parentElement: Node | null;
  children: ArrayLike<Node>;
};

// An id or class that a build tool or framework made up changes on the next deploy, so a selector built on it would not last.
const GENERATED = /\d{4,}|[0-9a-f]{8,}|^(css|sc|jsx)-/i;

// Anything else would need CSS escaping, so it counts as unusable.
const PLAIN_NAME = /^[A-Za-z_][\w-]*$/;

const is_usable_name = (name: string): boolean => PLAIN_NAME.test(name) && !GENERATED.test(name);

const usable_classes = (node: Node): string[] => Array.from(node.classList).filter(is_usable_name);

// The tag, narrowed by classes or by position only as far as its siblings need.
function step_of(node: Node, siblings: ArrayLike<Node>): string {
  const same_tag = Array.from(siblings).filter((sibling) => sibling.localName === node.localName);
  if (same_tag.length <= 1) return node.localName;
  const classes = usable_classes(node);
  if (classes.length > 0) {
    const shared = same_tag.filter((sibling) => {
      const own = new Set(Array.from(sibling.classList));
      return classes.every((name) => own.has(name));
    });
    if (shared.length === 1) return node.localName + classes.map((name) => `.${name}`).join("");
  }
  return `${node.localName}:nth-of-type(${same_tag.indexOf(node) + 1})`;
}

// `count_matches` counts the elements the selector matches in the root of the element, so the result is unique there. A shadow root or a frame document is its own root.
export function selector_of(element: Node, count_matches: (selector: string) => number): string {
  const steps: string[] = [];
  for (let node: Node | null = element; node; node = node.parentElement) {
    if (is_usable_name(node.id) && count_matches(`#${node.id}`) === 1) {
      steps.push(`#${node.id}`);
      break;
    }
    steps.push(step_of(node, node.parentElement?.children ?? [node]));
  }
  for (let length = 1; length < steps.length; length++) {
    const selector = steps.slice(0, length).reverse().join(" > ");
    if (count_matches(selector) === 1) return selector;
  }
  return steps.reverse().join(" > ");
}
