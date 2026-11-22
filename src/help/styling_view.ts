// The Styling page: the variables and classes a user stylesheet can set.

import { STYLE_CLASSES, STYLE_VARIABLES } from "./model.ts";
import { el, page_link } from "./dom.ts";
import { STYLING_SECTIONS, section_heading } from "./sections.ts";
import type { Section } from "./sections.ts";

function definition_table(rows: { name: string; meaning: string }[]): HTMLElement {
  return el("table", undefined, ...rows.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, row.meaning))));
}


export function styling_page(): HTMLElement[] {
  const [variables_section, classes_section] = STYLING_SECTIONS as [Section, Section];
  return [
    el("p", undefined, "You can change how DesertFox looks with CSS. Put your rules in a file named style.css in your settings files, or in the files editor on the ", page_link("Settings", "settings"), " page. Set a variable on the class of the part you want to restyle, for example .desertfox-whichkey { --desertfox-primary: red; }. A variable on :root or :host alone does not reach inside a part. A part reads only the colors it needs, so a color no part reads yet has no visible effect. The class names below are stable."),
    section_heading("styling", variables_section),
    definition_table(STYLE_VARIABLES),
    section_heading("styling", classes_section),
    definition_table(STYLE_CLASSES.map((entry) => ({ ...entry, name: `.${entry.name}` }))),
  ];
}
