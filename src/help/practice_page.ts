// The Practice page: a sequence of short lessons, each with a goal, the keys, a target to try them on and check lines that turn to "Done" when the page sees the step.
// The element ids are fixed, because the key test and the demo script address the targets and the check lines by id.

import { el, inline_node, new_tab_link, section_anchor, section_hash, section_heading } from "./render.ts";
import { parse_route } from "./route.ts";
import { ignore_refusal } from "../shared/swallow.ts";
import { practice_check_id, PRACTICE_VIDEO_URL } from "./practice_lessons.ts";
import type { LessonSlug, PracticeLesson } from "./practice_lessons.ts";
import type { Inline } from "./blocks.ts";

export type PracticeText = { intro: Inline[]; outro: Inline[]; lessons: PracticeLesson[] };

const FIND_PROSE = [
  "The desert fox keeps cool by being awake at night. Its large ears let heat leave the body, and its pale coat turns the sun away during the day.",
  "A fox listens before it moves. It can hear a beetle under the sand, and it tilts its head to place the sound before it pounces.",
  "Foxes dig dens deep into the dunes, where the sand stays cool at noon. At dusk the fox family comes out into the open and the day begins again.",
];
const COPY_FIRST_SENTENCE = "Rain is rare in the desert.";
const COPY_PROSE = [`${COPY_FIRST_SENTENCE} When it comes, seeds that waited for years bloom within days.`, "A dune moves a few steps each year. The wind lifts sand from one side and drops it on the other."];
const CHOICES = ["Sand", "Dune", "Oasis"];
const SLIDER_GOAL = "7";
const STRIP_WORDS = 60;

// The highlight the page search paints on its current match (`SEARCH_NAMES.current` in `src/content/caret/find_paint.ts`). The help page does not import the content bundle, so the name is repeated here.
const FIND_CURRENT_HIGHLIGHT = "oasis-find-current";
// What the visitor left the page for, kept across the rebuild that the way back causes, so its check can turn done.
const LEFT_FOR_KEY = "desertfox_practice_left";
// The ids of the check lines that are done, kept for the same rebuild. It lasts as long as the tab, so a new tab starts the lessons fresh.
const DONE_KEY = "desertfox_practice_done";
const WATCH_MS = 300;
// A heading jump puts the heading this close to the top of the view.
const HEADING_AT_TOP_PX = 12;

type Mark = (slug: LessonSlug, name: string) => void;
// A check the page cannot hear as an event. It runs on every watch tick and marks its own lines.
type Watch = () => void;

function labeled<T extends HTMLElement>(control: T, id: string, label: string): T {
  control.id = id;
  control.setAttribute("aria-label", label);
  return control;
}

function text_box(tag: "input" | "textarea", id: string, label: string): HTMLInputElement | HTMLTextAreaElement {
  const box = labeled(el(tag, "desertfox-settings-input") as HTMLInputElement | HTMLTextAreaElement, id, label);
  if (tag === "textarea") (box as HTMLTextAreaElement).rows = 3;
  else (box as HTMLInputElement).type = "text";
  return box;
}

function tick_box(type: "checkbox" | "radio", id: string, label: string): HTMLInputElement {
  const box = labeled(el("input", undefined) as HTMLInputElement, id, label);
  box.type = type;
  return box;
}

const with_label = (control: HTMLElement, label: string): HTMLElement => el("label", undefined, control, ` ${label}  `);
const stacked = (label: string, control: HTMLElement): HTMLElement => el("p", undefined, el("label", undefined, label, el("br", undefined), control));

function dropdown(id: string, label: string): HTMLSelectElement {
  return labeled(el("select", "desertfox-settings-input", ...CHOICES.map((choice) => el("option", undefined, choice))) as HTMLSelectElement, id, label);
}

function push_button(id: string, label: string): HTMLButtonElement {
  const button = el("button", undefined, label) as HTMLButtonElement;
  button.type = "button";
  button.id = id;
  return button;
}

function prose(id_start: string, texts: string[]): HTMLElement[] {
  return texts.map((text, index) => {
    const paragraph = el("p", undefined, text);
    paragraph.id = `${id_start}-${index + 1}`;
    return paragraph;
  });
}

const heading_top = (slug: LessonSlug): number => document.getElementById(section_anchor("practice", slug))?.getBoundingClientRect().top ?? Number.NaN;
// True while the lesson covers the middle of the view, wherever its heading is.
const in_lesson = (slug: LessonSlug): boolean => {
  const box = document.getElementById(section_anchor("practice", slug))?.closest("section")?.getBoundingClientRect();
  const middle = window.innerHeight / 2;
  return box !== undefined && box.top <= middle && box.bottom > middle;
};
const at_page_top = (): boolean => window.scrollY === 0;
const end_in_view = (): boolean => {
  const box = document.getElementById("practice-end")?.getBoundingClientRect();
  return box !== undefined && box.top >= 0 && box.bottom <= window.innerHeight + 2;
};

const j_count_text = (count: number): string => `The page received j ${count} time${count === 1 ? "" : "s"}.`;

// The targets of each lesson. A builder returns the elements under the steps and, where an event cannot tell, a watch.
type Built = { targets: HTMLElement[]; watch?: Watch };
type Builder = (mark: (name: string) => void) => Built;

const BUILDERS: Record<LessonSlug, Builder> = {
  scroll: (mark) => {
    const strip = el("div", "desertfox-practice-strip", el("p", undefined, Array.from({ length: STRIP_WORDS }, (_, index) => `dune ${index + 1}`).join("  ~  ")));
    strip.id = "practice-strip";
    let reached_end = false;
    return {
      targets: [strip],
      watch: () => {
        if (!at_page_top()) mark("down");
        if (end_in_view()) {
          reached_end = true;
          mark("end");
        }
        if (reached_end && at_page_top()) mark("top");
        if (strip.scrollLeft > 0) mark("strip");
      },
    };
  },
  "which-key": (mark) => {
    let start: number | undefined;
    let zoomed = false;
    return {
      targets: [],
      watch: () => {
        start ??= window.devicePixelRatio;
        if (window.devicePixelRatio > start * 1.05) {
          zoomed = true;
          mark("zoomed");
        }
        if (zoomed && window.devicePixelRatio <= start * 1.01) mark("reset");
      },
    };
  },
  headings: (mark) => {
    // Where the page last stood still. A scroll key can animate over several ticks, so a move is judged from rest to rest.
    let rest: { scroll: number; in_this_lesson: boolean } | undefined;
    let last_scroll: number | undefined;
    return {
      targets: [],
      watch: () => {
        const still = last_scroll === window.scrollY;
        last_scroll = window.scrollY;
        if (!still) return;
        // Only a move that starts in this lesson, crosses more than half a screen and ends with a heading at the top counts. Line scrolling and a jump made in another lesson do not.
        if (rest?.in_this_lesson && Math.abs(window.scrollY - rest.scroll) > window.innerHeight / 2) {
          const at_top = (heading: Element) => Math.abs(heading.getBoundingClientRect().top) < HEADING_AT_TOP_PX;
          if (Array.from(document.querySelectorAll(".desertfox-practice-lesson h2")).some(at_top)) mark("heading");
          if (Math.abs(heading_top("slider")) < HEADING_AT_TOP_PX) mark("listed");
        }
        rest = { scroll: window.scrollY, in_this_lesson: in_lesson("headings") };
      },
    };
  },
  hints: (mark) => {
    const bell = push_button("practice-bell", "Ring the bell");
    bell.addEventListener("click", () => mark("bell"));
    const details = el("details", undefined, el("summary", undefined, "Show more"), el("p", undefined, "This text shows while the section is open.")) as HTMLDetailsElement;
    details.id = "practice-details";
    details.addEventListener("toggle", () => { if (details.open) mark("section"); });
    const lights = tick_box("checkbox", "practice-lights", "Lights on");
    lights.addEventListener("change", () => { if (lights.checked) mark("lights"); });
    return { targets: [el("p", undefined, bell), details, el("p", undefined, with_label(lights, "Lights on"))] };
  },
  form: (mark) => {
    const boxes = [text_box("input", "practice-name", "Name"), text_box("input", "practice-email", "Email"), text_box("textarea", "practice-note", "Note")];
    for (const box of boxes) box.addEventListener("input", () => { if (boxes.every((each) => each.value.trim() !== "")) mark("typed"); });
    const subscribe = tick_box("checkbox", "practice-subscribe", "Send me news");
    subscribe.addEventListener("change", () => { if (subscribe.checked) mark("ticked"); });
    const topic = dropdown("practice-topic", "Topic");
    topic.addEventListener("input", () => { if (topic.value !== CHOICES[0]) mark("chosen"); });
    const send = push_button("practice-send", "Send");
    send.addEventListener("click", () => mark("sent"));
    return { targets: [stacked("Name", boxes[0]!), stacked("Email", boxes[1]!), stacked("Note", boxes[2]!), el("p", undefined, with_label(subscribe, "Send me news")), stacked("Topic", topic), el("p", undefined, send)] };
  },
  inputs: (mark) => {
    const radios = ["Alpha", "Bravo", "Charlie"].map((text, index) => {
      const radio = tick_box("radio", `practice-radio-${index + 1}`, text);
      radio.name = "practice-radio-group";
      return radio;
    });
    let chose_bravo = false;
    radios[1]!.addEventListener("change", () => {
      chose_bravo = true;
      mark("bravo");
    });
    radios[2]!.addEventListener("change", () => { if (chose_bravo) mark("charlie"); });
    const group = el("fieldset", undefined, el("legend", undefined, "Pick one"), ...radios.map((radio) => with_label(radio, radio.getAttribute("aria-label")!)));
    group.id = "practice-radio";
    const select = dropdown("practice-select", "Dropdown");
    select.addEventListener("input", () => { if (select.value === CHOICES[2]) mark("oasis"); });
    const boxes = ["Sun", "Moon", "Stars"].map((text, index) => tick_box("checkbox", `practice-box-${index + 1}`, text));
    for (const box of boxes) box.addEventListener("change", () => { if (boxes.every((each) => each.checked)) mark("rapid"); });
    const done = push_button("practice-done", "Done");
    done.addEventListener("click", () => mark("done"));
    return { targets: [group, el("p", undefined, select), el("p", undefined, ...boxes.map((box) => with_label(box, box.getAttribute("aria-label")!))), el("p", undefined, done)] };
  },
  slider: (mark) => {
    const range = labeled(el("input", undefined) as HTMLInputElement, "practice-range", "Slider");
    range.type = "range";
    range.min = "0";
    range.max = "10";
    range.value = "2";
    const reading_text = () => `The slider reads ${range.value}. Set it to ${SLIDER_GOAL}.`;
    const reading = el("span", undefined, reading_text());
    reading.id = "practice-range-reading";
    range.addEventListener("input", () => { reading.textContent = reading_text(); });
    // A drop or a blur sends `change`, so a value passed on the way does not count.
    range.addEventListener("change", () => { if (range.value === SLIDER_GOAL) mark("seven"); });
    const card = el("span", "desertfox-pill", "Fox");
    card.id = "practice-card";
    card.setAttribute("draggable", "true");
    card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/plain", "Fox"));
    const den = el("div", "desertfox-help-tip", "Den: ");
    den.id = "practice-den";
    den.addEventListener("dragover", (event) => event.preventDefault());
    den.addEventListener("drop", (event) => {
      event.preventDefault();
      den.append(card);
      mark("den");
    });
    return { targets: [el("p", undefined, range, " ", reading), el("p", undefined, card), den] };
  },
  find: (mark) => {
    let first: string | undefined;
    return {
      targets: prose("practice-prose", FIND_PROSE),
      watch: () => {
        const highlights = (CSS as unknown as { highlights?: Map<string, Iterable<Range>> }).highlights;
        const [range] = highlights?.get(FIND_CURRENT_HIGHLIGHT) ?? [];
        if (range === undefined) return;
        const place = `${range.startContainer.parentElement?.id}:${range.startOffset}`;
        first ??= place;
        mark("found");
        if (place !== first) mark("stepped");
      },
    };
  },
  copy: (mark) => {
    const paste = text_box("textarea", "practice-paste", "Paste box");
    paste.addEventListener("input", () => {
      if (paste.value.includes(COPY_PROSE[1]!)) mark("paragraph");
      if (paste.value.includes(COPY_FIRST_SENTENCE) && !paste.value.includes(COPY_PROSE[0]!)) mark("sentence");
    });
    return { targets: [...prose("practice-copy", COPY_PROSE), stacked("Paste box", paste)] };
  },
  "command-line": (mark) => {
    const background = () => getComputedStyle(document.documentElement).getPropertyValue("--desertfox-bg-core");
    let start: string | undefined;
    let themed = false;
    return {
      targets: [],
      watch: () => {
        start ??= background();
        if (background() !== start) {
          themed = true;
          mark("themed");
        }
        if (themed && background() === start) mark("restored");
      },
    };
  },
  tabs: (mark) => {
    const pages = ["settings", "commands"];
    const links = pages.map((page) => {
      const link = new_tab_link(page === "settings" ? "Settings" : "Commands", `home.html#/${page}`);
      link.id = `practice-open-${page}`;
      return link;
    });
    let opened = false;
    let hidden_since_open = false;
    let ticks = 0;
    // The Settings tabs this watch has seen. Each is judged once, when it first shows, so a tab the visitor drags away is not moved back.
    const seen_settings_tabs = new Set<number>();
    // The close key moves to the tab after the closed one, so the Settings tab goes just before this tab. Closing it then lands here, whatever other tabs are open.
    // Only a tab that first shows while this lesson is in view is moved. One opened from another lesson, such as from the sidebar, stays where it is.
    const put_new_settings_tab_before_this_one = async (tabs: browser.tabs.Tab[]): Promise<void> => {
      const new_tabs = tabs.filter((tab) => tab.id !== undefined && !seen_settings_tabs.has(tab.id) && tab.url?.endsWith(`#/${pages[0]}`));
      for (const tab of new_tabs) seen_settings_tabs.add(tab.id!);
      if (new_tabs.length === 0 || !in_lesson("tabs")) return;
      const own = await browser.tabs.getCurrent();
      const settings = new_tabs.find((tab) => tab.openerTabId === own?.id);
      if (own?.id === undefined || settings?.id === undefined || settings.index === own.index - 1) return;
      await browser.tabs.move(settings.id, { index: settings.index < own.index ? own.index - 1 : own.index });
    };
    return {
      targets: [el("p", undefined, links[0]!, "  ", links[1]!)],
      watch: () => {
        if (opened && document.hidden) hidden_since_open = true;
        if (hidden_since_open && !document.hidden) mark("returned");
        // The tab list is read every fifth tick, because the answer comes from the browser and changes slowly.
        if (ticks++ % 5 !== 0) return;
        void browser.tabs.query({ currentWindow: true }).then((tabs) => {
          // The tab can close while the move is on its way.
          void ignore_refusal(put_new_settings_tab_before_this_one(tabs));
          const open_count = pages.filter((page) => tabs.some((tab) => tab.url?.endsWith(`#/${page}`))).length;
          if (open_count === pages.length) {
            opened = true;
            mark("opened");
          }
          if (opened && open_count === 0) mark("closed");
        });
      },
    };
  },
  video: () => {
    const link = el("a", undefined, "Never Gonna Give You Up, on YouTube");
    link.id = "practice-video-link";
    link.setAttribute("href", PRACTICE_VIDEO_URL);
    link.addEventListener("click", () => sessionStorage.setItem(LEFT_FOR_KEY, "video"));
    return { targets: [el("p", undefined, link)] };
  },
  marks: (mark) => {
    // Where the tick before this one saw the page, when that was the end or the start. A mark jump and the jump back are instant, so they bring the lesson back within one tick. Scrolling back passes other places first and does not count.
    let away_at: "end" | "top" | undefined;
    let was_here = false;
    return {
      targets: [],
      watch: () => {
        const here = in_lesson("marks");
        if (here && away_at !== undefined) mark(away_at === "end" ? "marked" : "jumped");
        if (here) was_here = true;
        // Only a trip that started with this lesson on screen counts.
        away_at = here || !was_here ? undefined : end_in_view() ? "end" : at_page_top() ? "top" : undefined;
      },
    };
  },
  ignore: () => {
    const count_line = el("p", "desertfox-help-tip", j_count_text(0));
    count_line.id = "practice-j-count";
    return { targets: [count_line] };
  },
};

// A unit test renders the page in Node, which has no session storage.
const session = (): Storage | undefined => (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
const done_ids = (): string[] => JSON.parse(session()?.getItem(DONE_KEY) ?? "[]") as string[];

function show_done(line: HTMLElement, text: string): void {
  line.setAttribute("data-done", "true");
  line.className = "";
  line.textContent = `Done: ${text}`;
}

function check_lines(lesson: PracticeLesson, done: string[]): HTMLElement {
  return el("ul", undefined, ...lesson.checks.map(({ name, text }) => {
    const line = el("li", "desertfox-help-muted", `To do: ${text}`);
    line.id = practice_check_id(lesson.slug, name);
    line.setAttribute("data-done", "false");
    line.setAttribute("data-text", text);
    if (done.includes(line.id)) show_done(line, text);
    return line;
  }));
}

const mark_done: Mark = (slug, name) => {
  const line = document.getElementById(practice_check_id(slug, name));
  if (!line || line.getAttribute("data-done") === "true") return;
  show_done(line, line.getAttribute("data-text") ?? "");
  session()?.setItem(DONE_KEY, JSON.stringify([...done_ids(), line.id]));
};

// Counts the `j` presses that reach the page itself. A key DesertFox takes never gets here, and one typed into a field is text, not a shortcut.
function count_page_keys(): (event: KeyboardEvent) => void {
  let count = 0;
  return (event) => {
    if (event.key !== "j" || event.ctrlKey || event.altKey || event.metaKey || (event.target as Element | null)?.closest?.("input, textarea, select")) return;
    count += 1;
    const line = document.getElementById("practice-j-count");
    if (line) line.textContent = j_count_text(count);
    mark_done("ignore", "passed");
    if (count >= 4) mark_done("ignore", "ignored");
  };
}

// Leaving for the Commands page or the video rebuilds this page on the way back, so the leave is noted in the session and read here.
function mark_return(): void {
  const left_for = sessionStorage.getItem(LEFT_FOR_KEY);
  if (left_for === null) return;
  sessionStorage.removeItem(LEFT_FOR_KEY);
  mark_done(left_for === "video" ? "video" : "command-line", "returned");
}

// Keeps the lesson the visitor is in as the address of the page, so the way back from another page lands on it. No history entry is added.
function remember_lesson(lessons: PracticeLesson[]): Watch {
  let remembered: string | undefined;
  return () => {
    // The first lesson sits right under the welcome line, so the top of the page is no lesson: a reload there keeps the welcome line in view.
    const current = at_page_top() ? undefined : lessons.filter((lesson) => heading_top(lesson.slug) < window.innerHeight / 2).at(-1);
    const hash = current ? section_hash("practice", current.slug) : "#/practice";
    if (hash === remembered) return;
    remembered = hash;
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
  };
}

// Runs the watches while the page is shown. `anchor` leaves the document when another help page replaces this one, which ends the run and removes the listeners.
function start_watching(anchor: HTMLElement, lessons: PracticeLesson[], watches: Watch[]): void {
  const on_key = count_page_keys();
  // A move to the Commands page changes the hash. The key that runs `:help commands` gives no other sign.
  const on_hash = () => { if (parse_route(location.hash).page === "commands") sessionStorage.setItem(LEFT_FOR_KEY, "help"); };
  const keep_place = remember_lesson(lessons);
  let started = false;
  const timer = setInterval(() => {
    if (!anchor.isConnected) {
      clearInterval(timer);
      if (!started) return;
      document.removeEventListener("keydown", on_key);
      window.removeEventListener("pageshow", mark_return);
      window.removeEventListener("hashchange", on_hash);
      return;
    }
    if (!started) {
      started = true;
      document.addEventListener("keydown", on_key);
      // A page restored from the back-forward cache is not rebuilt, so the return is read here too.
      window.addEventListener("pageshow", mark_return);
      window.addEventListener("hashchange", on_hash);
      mark_return();
    }
    for (const watch of watches) watch();
    keep_place();
  }, WATCH_MS);
  // A unit test renders the page in Node, where a live timer would hold the process open.
  (timer as unknown as { unref?: () => void }).unref?.();
}

function lesson_section(lesson: PracticeLesson, built: Built, done: string[]): HTMLElement {
  return el(
    "section",
    "desertfox-practice-lesson",
    section_heading("practice", { title: lesson.title, slug: lesson.slug }),
    el("p", undefined, ...lesson.goal.map(inline_node)),
    el("ol", undefined, ...lesson.steps.map((step) => el("li", undefined, ...step.map(inline_node)))),
    ...built.targets,
    ...lesson.notes.map((note) => el("p", "desertfox-help-muted", ...note.map(inline_node))),
    check_lines(lesson, done),
  );
}

export function practice_page(text: PracticeText): HTMLElement[] {
  const intro = el("div", "desertfox-practice-intro", el("div", "desertfox-help-tip", ...text.intro.map(inline_node)));
  const built = text.lessons.map((lesson) => BUILDERS[lesson.slug]((name) => mark_done(lesson.slug, name)));
  const end = el("p", undefined, ...text.outro.map(inline_node));
  end.id = "practice-end";
  start_watching(intro, text.lessons, built.flatMap(({ watch }) => (watch ? [watch] : [])));
  const done = done_ids();
  return [intro, ...text.lessons.map((lesson, index) => lesson_section(lesson, built[index]!, done)), end];
}
