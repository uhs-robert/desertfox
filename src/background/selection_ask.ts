// Reads the selection of a frame, and the scroll offset of its top page. The `page` bundle answers `get_selection`, not content.js, so a frame that has not loaded the bundle gives no answer to the first ask.

export type SelectionAskDeps = {
  // Sends the question to the frame. Resolves with nothing when no script in the frame answers.
  ask: (tab_id: number, frame_id: number) => Promise<unknown>;
  // A failed load needs no report: the second ask then gets no answer.
  load_page_bundle: (tab_id: number, frame_id: number) => Promise<unknown>;
};

// Asks first and loads the bundle only on no answer, so a frame that has the bundle pays no injection. Nothing when the frame cannot answer at all.
export async function ask_page_bundle(deps: SelectionAskDeps, tab_id: number, frame_id: number): Promise<unknown> {
  const ask = () => deps.ask(tab_id, frame_id).catch(() => undefined);
  const answer = await ask();
  if (answer !== undefined) return answer;
  await deps.load_page_bundle(tab_id, frame_id).catch(() => undefined);
  return ask();
}

export async function ask_selection(deps: SelectionAskDeps, tab_id: number, frame_id: number): Promise<string | undefined> {
  const answer = await ask_page_bundle(deps, tab_id, frame_id);
  return typeof answer === "string" ? answer : undefined;
}
