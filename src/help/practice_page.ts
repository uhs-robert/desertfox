// The Practice page: one small target for each kind of key, so a reader can try them with nothing at stake.
// The element ids are fixed because the key test and the demo script address the targets by id.

import { el, inline_node, new_tab_link, page_sections, section_hash, section_heading } from "./render.ts";
import { PRACTICE_AREAS } from "./quick_start.ts";
import type { PracticeArea } from "./quick_start.ts";
import type { Inline } from "./blocks.ts";

export const PRACTICE_LOG_ID = "practice-log";

const PROSE = [
  "The desert fox keeps cool by being awake at night. Its large ears let heat leave the body, and its pale coat turns the sun away during the day.",
  "A fox listens before it moves. It can hear a beetle under the sand, and it tilts its head to place the sound before it pounces.",
  "Foxes dig dens deep into the dunes, where the sand stays cool at noon. At dusk the family comes out into the open and the day begins again.",
];

// Each link jumps to a section of this page, so following one shows a visible move. The page keeps its state across the jump (KEEPS_STATE_PAGES in main.ts).
const LINKS: { text: string; area: PracticeArea }[] = [
  { text: "Jump to search", area: "find" },
  { text: "Jump to caret mode", area: "caret" },
  { text: "Jump to typing", area: "insert" },
  { text: "Jump to the command line section near the end of this page", area: "cmdline" },
  { text: "Jump to scrolling", area: "scroll" },
];
const SCROLL_LINES = 40;

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
    log.textContent = `Clicked ${label}, ${count} time${count === 1 ? "" : "s"}.`;
  });
  return button;
}

function checkbox(log: HTMLElement): HTMLElement {
  const box = el("input", undefined) as HTMLInputElement;
  box.type = "checkbox";
  box.id = "practice-checkbox";
  // A hint names a box with no text of its own by this label, so a typed name finds it.
  box.setAttribute("aria-label", "A checkbox");
  box.addEventListener("change", () => { log.textContent = `The checkbox is ${box.checked ? "on" : "off"}.`; });
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

function slider(log: HTMLElement): HTMLElement {
  const range = el("input", undefined) as HTMLInputElement;
  range.type = "range";
  range.id = "practice-range";
  range.min = "0";
  range.max = "10";
  range.value = "2";
  range.setAttribute("aria-label", "Range input");
  range.addEventListener("input", () => { log.textContent = `The slider is at ${range.value}.`; });
  return el("p", undefined, range);
}

const DROPDOWN_CHOICES = ["Sand", "Dune", "Oasis"];

function dropdown(log: HTMLElement): HTMLElement {
  const select = el("select", "desertfox-settings-input", ...DROPDOWN_CHOICES.map((choice) => el("option", undefined, choice))) as HTMLSelectElement;
  select.id = "practice-select";
  select.setAttribute("aria-label", "Choices list");
  select.addEventListener("input", () => { log.textContent = `The dropdown shows ${select.value}.`; });
  return el("p", undefined, select);
}

function radio_group(log: HTMLElement): HTMLElement {
  const choices = ["Alpha", "Bravo", "Charlie"].map((text, index) => {
    const radio = el("input", undefined) as HTMLInputElement;
    radio.type = "radio";
    radio.name = "practice-radio-group";
    radio.id = `practice-radio-${index + 1}`;
    radio.setAttribute("aria-label", text);
    radio.addEventListener("change", () => { log.textContent = `${text} is chosen.`; });
    return el("label", undefined, radio, ` ${text}  `);
  });
  const group = el("fieldset", undefined, el("legend", undefined, "Pick one"), ...choices);
  group.id = "practice-radio";
  return group;
}

function details_section(log: HTMLElement): HTMLElement {
  const details = el("details", undefined, el("summary", undefined, "Reveal more"), el("p", undefined, "This text shows while the section is open.")) as HTMLDetailsElement;
  details.id = "practice-details";
  details.addEventListener("toggle", () => { log.textContent = `The section is ${details.open ? "open" : "closed"}.`; });
  return details;
}

function prompt(inlines: Inline[]): HTMLElement {
  return el("div", "desertfox-help-tip", ...inlines.map(inline_node));
}

function practice_tab_link(text: string, page: string, id: string, log: HTMLElement): HTMLElement {
  const link = new_tab_link(text, `home.html#/${page}`);
  link.id = id;
  link.addEventListener("click", () => { log.textContent = `Opened ${text}.`; });
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
    ...head("slider"),
    slider(log),
    ...head("dropdown"),
    dropdown(log),
    ...head("radio"),
    radio_group(log),
    ...head("details"),
    details_section(log),
    ...head("whichkey"),
    ...head("cmdline"),
    ...head("tabs"),
    el("p", undefined, practice_tab_link("Settings", "settings", "practice-open-settings", log), "  ", practice_tab_link("Commands", "commands", "practice-open-commands", log)),
    ...head("scroll"),
    scroll_area(),
  ];
}
