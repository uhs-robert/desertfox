// The Quick Start page: the guide text as blocks.

import type { Block } from "./blocks.ts";
import { block_node } from "./dom.ts";
import { page_sections, section_heading } from "./sections.ts";

// The level-2 headings of the guide get the ids the sidebar links to. Their slugs come from the same list, in order.
export function quick_start_page(blocks: Block[]): HTMLElement[] {
  const sections = [...page_sections("quick-start", blocks)];
  return blocks.map((block) => {
    if (block.kind !== "heading" || block.level !== 2) return block_node(block);
    return section_heading("quick-start", sections.shift()!);
  });
}
