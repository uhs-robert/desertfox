// The list view: a window of at most ten rows over the ranked rows, with no scroll bar. It draws rows only.
// Widths belong to the page's CSS: the description shrinks first, then the args collapse to "…".

import type { Row, TabMarks } from "./completion/sources.ts";
import type { Ranked } from "../shared/score.ts";

export const MAX_ROWS = 10;
// Names longer than this are cut with an ellipsis, so one long name cannot take the whole row.
const MAX_NAME_COLUMNS = 28;

// Moves the window the least that keeps the selected row inside it.
export function window_top(top: number, selected: number, count: number): number {
  const kept = selected < 0 ? top : selected < top ? selected : selected >= top + MAX_ROWS ? selected - MAX_ROWS + 1 : top;
  return Math.max(0, Math.min(kept, count - MAX_ROWS));
}

function cell(class_name: string, text = ""): HTMLElement {
  const element = document.createElement("span");
  element.className = `oasisfox-cmdline-${class_name}`;
  element.textContent = text;
  return element;
}

// The name with the matched letters in bold.
function name_cell(row: Ranked<Row>): HTMLElement {
  const name = cell("name");
  const hits = new Set(row.positions);
  let run = "";
  let run_hit = false;
  const flush = () => {
    if (run === "") return;
    const part = run_hit ? document.createElement("b") : document.createElement("span");
    part.textContent = run;
    name.append(part);
    run = "";
  };
  [...row.name].forEach((char, index) => {
    if (hits.has(index) !== run_hit) {
      flush();
      run_hit = !run_hit;
    }
    run += char;
  });
  flush();
  return name;
}

// Every flag icon takes this much width, so the name column starts at the same place in every row.
const FLAG_WIDTH_PX = 14;

function image_cell(class_name: string, url: string, on_error: () => void): HTMLElement {
  const holder = cell(class_name);
  const image = document.createElement("img");
  image.src = url;
  image.onerror = () => {
    image.hidden = true;
    on_error();
  };
  holder.append(image);
  return holder;
}

function status_cell(marks: TabMarks): HTMLElement {
  const status = cell("tab-status");
  status.append(cell("tab-mark", marks.status), ...marks.flags.map((flag) => cell(`flag oasisfox-cmdline-flag-${flag}`)));
  return status;
}

// The icon is a mask over the container color, because an image of the icon would draw black: Firefox's icons take their fill from the page, which an <img> cannot give.
// The <img> stays, hidden, only to learn whether the icon loads. A container without a loadable icon keeps its color as a dot.
function container_cell(marks: TabMarks): HTMLElement {
  if (!marks.container) return cell("container");
  const holder = image_cell("container", marks.container.icon, () => void (holder.className += " oasisfox-cmdline-container-dot"));
  holder.style.setProperty("--oasisfox-container-color", marks.container.color);
  holder.style.setProperty("--oasisfox-container-icon", `url(${JSON.stringify(marks.container.icon)})`);
  return holder;
}

// A tab without a loadable favicon keeps the plain glyph that every favicon cell draws behind its image.
const favicon_cell = (marks: TabMarks): HTMLElement => (marks.favicon ? image_cell("favicon", marks.favicon, () => {}) : cell("favicon"));

// `keys_of` gives the keys cell text of a command id.
export function create_list(element: HTMLElement, keys_of: (id: string) => string = () => "") {
  let top = 0;
  let drawn: readonly Ranked<Row>[] | undefined;
  return {
    render: (rows: readonly Ranked<Row>[], selected: number) => {
      element.hidden = rows.length === 0;
      // A new ranking starts at the top. The same one, previewed, keeps the window.
      top = window_top(rows === drawn ? top : 0, selected, rows.length);
      drawn = rows;
      const visible = rows.slice(top, top + MAX_ROWS);
      element.style.setProperty("--oasisfox-name-width", `${Math.min(MAX_NAME_COLUMNS, Math.max(...visible.map((row) => row.name.length), 0))}ch`);
      const keys = visible.map((row) => (row.id === undefined ? "" : keys_of(row.id)));
      element.style.setProperty("--oasisfox-keys-width", `${Math.max(...keys.map((text) => text.length), 0)}ch`);
      const flag_count = Math.max(...visible.map((row) => row.tab?.flags.length ?? 0), 0);
      element.style.setProperty("--oasisfox-flags-width", `${flag_count * FLAG_WIDTH_PX}px`);
      element.replaceChildren(
        ...visible.map((row, offset) => {
          const item = cell(`item${top + offset === selected ? " oasisfox-cmdline-selected" : ""}${row.unavailable ? " oasisfox-cmdline-unavailable" : ""}`);
          const args = cell("args");
          args.append(cell("args-full", row.args), cell("args-short", row.args ? "…" : ""));
          if (row.tab) item.append(status_cell(row.tab), container_cell(row.tab), favicon_cell(row.tab));
          item.append(name_cell(row), cell("description", row.description), args, ...(row.tag ? [cell("tag", row.tag)] : []), cell("keys", keys[offset]));
          return item;
        }),
      );
    },
  };
}
