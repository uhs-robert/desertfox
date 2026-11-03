// The list view: a window of at most ten rows over the ranked rows, with no scroll bar. It draws rows only.
// Widths belong to the page's CSS: the description shrinks first, then the args collapse to "…".

import type { Row } from "./completion/sources.ts";
import type { Ranked } from "./completion/score.ts";

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

export function create_list(element: HTMLElement) {
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
      element.replaceChildren(
        ...visible.map((row, offset) => {
          const item = cell(top + offset === selected ? "item oasisfox-cmdline-selected" : "item");
          const args = cell("args");
          args.append(cell("args-full", row.args), cell("args-short", row.args ? "…" : ""));
          item.append(name_cell(row), cell("description", row.description), args);
          return item;
        }),
      );
    },
  };
}
