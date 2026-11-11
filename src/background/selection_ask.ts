// Reads the selection of a frame. The `page` bundle answers `get_selection`, not content.js, so a frame that has not loaded the bundle gives no answer to the first ask.

export type SelectionAskDeps = {
  // Sends `get_selection` to the frame. Resolves with nothing when no script in the frame answers.
  ask: (tab_id: number, frame_id: number) => Promise<unknown>;
  load_page_bundle: (tab_id: number, frame_id: number) => Promise<void>;
};

// Asks first and loads the bundle only on no answer, so a frame that has the bundle pays no injection. Nothing when the frame cannot answer at all.
export async function ask_selection(deps: SelectionAskDeps, tab_id: number, frame_id: number): Promise<string | undefined> {
  const ask = () => deps.ask(tab_id, frame_id).catch(() => undefined);
  let answer = await ask();
  if (answer === undefined) {
    await deps.load_page_bundle(tab_id, frame_id).catch(() => undefined);
    answer = await ask();
  }
  return typeof answer === "string" ? answer : undefined;
}
