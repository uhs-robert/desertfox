// The Practice page: one small target for each kind of key, so a reader can try them with nothing at stake.
// The element ids are fixed because the key test and the demo script address the targets by id.

import { el, inline_node, page_sections, section_hash, section_heading } from "./render.ts";
import { PRACTICE_AREAS } from "./quick_start.ts";
import type { PracticeArea } from "./quick_start.ts";
import type { Inline } from "./blocks.ts";

export const PRACTICE_LOG_ID = "practice-log";

const PROSE = [
  "The desert fox keeps cool by being awake at night. Its large ears let heat leave the body, and its pale coat turns the sun away during the day.",
  "A fox listens before it moves. It can hear a beetle under the sand, and it tilts its head to place the sound before it pounces.",
  "Foxes dig dens deep into the dunes, where the sand stays cool at noon. At dusk the family comes out into the open and the day begins again.",
];

// Each link jumps to a section of this page. A hint follows a link by loading its address, so a link that fired only a click handler would do nothing.
const LINKS: { text: string; area: PracticeArea }[] = [
  { text: "Jump to search", area: "find" },
  { text: "Jump to caret mode", area: "caret" },
  { text: "Jump to typing", area: "insert" },
  { text: "Jump to the command line section near the end of this page", area: "cmdline" },
  { text: "Jump to scrolling", area: "scroll" },
];
const SCROLL_LINES = 40;

function log_into(line: HTMLElement, text: string): void {
  line.textContent = text;
}

function target_link(text: string, href: string, index: number): HTMLElement {
  const link = el("a", undefined, text);
  link.id = `practice-link-${index + 1}`;
  link.setAttribute("href", href);
  return link;
}

function echo_button(label: string, id: string, log: HTMLElement): HTMLElement {
  const button = el("button", undefined, label) as HTMLButtonElement;
  button.type = "button";
  button.id = id;
  let count = 0;
  button.addEventListener("click", () => {
    count += 1;
    log_into(log, `Clicked ${label}, ${count} time${count === 1 ? "" : "s"}.`);
  });
  return button;
}

function checkbox(log: HTMLElement): HTMLElement {
  const box = el("input", undefined) as HTMLInputElement;
  box.type = "checkbox";
  box.id = "practice-checkbox";
  // A hint names a box with no text of its own by this label, so a typed name finds it.
  box.setAttribute("aria-label", "A checkbox");
  box.addEventListener("change", () => log_into(log, `The checkbox is ${box.checked ? "on" : "off"}.`));
  return el("label", undefined, box, " A checkbox");
}

// A box with a visible label and an id, so a hint or a click reaches it and a script can read it.
function field(tag: "input" | "textarea", id: string, label: string): HTMLElement {
  const box = el(tag, "desertfox-settings-input") as HTMLInputElement | HTMLTextAreaElement;
  box.id = id;
  box.setAttribute("aria-label", label);
  if (tag === "textarea") (box as HTMLTextAreaElement).rows = 3;
  else (box as HTMLInputElement).type = "text";
  return el("p", undefined, el("label", undefined, label, el("br", undefined), box));
}

function prompt(inlines: Inline[]): HTMLElement {
  return el("div", "desertfox-help-tip", ...inlines.map(inline_node));
}

function new_tab_link(text: string, page: string, id: string, log: HTMLElement): HTMLElement {
  const link = el("a", undefined, text);
  link.id = id;
  link.setAttribute("href", `home.html#/${page}`);
  link.setAttribute("target", "_blank");
  link.addEventListener("click", () => log_into(log, `Opened ${text}.`));
  return link;
}

function scroll_area(): HTMLElement {
  const lines = Array.from({ length: SCROLL_LINES }, (_, index) => el("p", "desertfox-help-muted", `Line ${index + 1} of ${SCROLL_LINES}`));
  const end = el("p", undefined, "That is the end of the practice page.");
  end.id = "practice-end";
  const area = el("div", undefined, ...lines, end);
  area.id = "practice-scroll";
  return area;
}

export function practice_page(prompts: Record<PracticeArea, Inline[]>): HTMLElement[] {
  const sections = page_sections("practice", []);
  const section_of = (area: PracticeArea) => sections[PRACTICE_AREAS.findIndex((entry) => entry.area === area)]!;
  const head = (area: PracticeArea) => [section_heading("practice", section_of(area)), prompt(prompts[area])];
  const log = el("p", "desertfox-help-muted", "Nothing clicked yet.");
  log.id = PRACTICE_LOG_ID;
  log.setAttribute("aria-live", "polite");
  const paragraphs = PROSE.map((text, index) => {
    const paragraph = el("p", undefined, text);
    paragraph.id = `practice-prose-${index + 1}`;
    return paragraph;
  });
  return [
    el("p", undefined, "Every target on this page is safe to click, type in and select. Nothing here changes your settings except the one command line example."),
    ...head("hints"),
    el("p", undefined, ...LINKS.flatMap(({ text, area }, index) => [target_link(text, section_hash("practice", section_of(area).slug), index), "  "])),
    el("p", undefined, echo_button("Button one", "practice-button-1", log), " ", echo_button("Button two", "practice-button-2", log), "  ", checkbox(log)),
    log,
    ...head("find"),
    ...head("caret"),
    ...paragraphs,
    el("p", undefined, "Paste target. Copy a selection, then paste it here."),
    field("textarea", "practice-paste", "Paste box"),
    ...head("insert"),
    field("input", "practice-input", "Text box"),
    field("textarea", "practice-textarea", "Text area"),
    ...head("whichkey"),
    ...head("cmdline"),
    ...head("tabs"),
    el("p", undefined, new_tab_link("Settings", "settings", "practice-open-settings", log), "  ", new_tab_link("Commands", "commands", "practice-open-commands", log)),
    ...head("scroll"),
    scroll_area(),
  ];
}
