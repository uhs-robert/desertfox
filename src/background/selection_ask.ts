import { best_effort, refused_as } from "../shared/swallow.ts";
// Reads the selection of a frame, and the scroll offset of its top page. The `page` bundle answers `get_selection`, not content.js, so a frame that has not loaded the bundle gives no answer to the first ask.

export type SelectionAskDeps = {
  // Sends the question to the frame. Resolves with nothing when no script in the frame answers.
  ask: (tab_id: number, frame_id: number) => Promise<unknown>;
  // A failed load needs no report: the second ask then gets no answer.
  load_page_bundle: (tab_id: number, frame_id: number) => Promise<unknown>;
  // The browser module's read of the selected tab, for a parent-process about: page where no content script runs. The reply is foreign text. Undefined when the module cannot read the tab.
  read_from_module?: (tab_id: number) => Promise<string | undefined>;
};

export const MAX_MODULE_SELECTION_CHARS = 1000;

// Line breaks and tabs become one space, so two selected lines stay two words. Other control and format characters go, then the cap. The text is data for a command line or a search, never code or an address. Typed text holds no line break, so the panel's typed keys share this rule.
export const cleaned_line = (text: string, max_chars: number): string => [...text.replace(/[\r\n\t]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, max_chars).join("");
export const cleaned_module_selection = (text: string): string => cleaned_line(text, MAX_MODULE_SELECTION_CHARS);

// Asks first and loads the bundle only on no answer, so a frame that has the bundle pays no injection. Nothing when the frame cannot answer at all.
export async function ask_page_bundle(deps: SelectionAskDeps, tab_id: number, frame_id: number): Promise<unknown> {
  const ask = () => refused_as(deps.ask(tab_id, frame_id), undefined);
  const answer = await ask();
  if (answer !== undefined) return answer;
  await best_effort(deps.load_page_bundle(tab_id, frame_id));
  return ask();
}

export async function ask_selection(deps: SelectionAskDeps, tab_id: number, frame_id: number): Promise<string | undefined> {
  const answer = await ask_page_bundle(deps, tab_id, frame_id);
  if (typeof answer === "string") return answer;
  // The module reads the tab's top page only.
  return frame_id === 0 && deps.read_from_module !== undefined ? refused_as(deps.read_from_module(tab_id), undefined) : undefined;
}
