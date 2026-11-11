// Physical keys whose keydown was cancelled: their keypress and keyup are cancelled too.
// So is the keyup of a key whose keydown this frame never saw. A press belongs to the frame that got its keydown, and the page of another frame must not act on the keyup alone. Google Docs focuses its editor again on the Escape keyup that follows a focus hand-off (`hand_focus_to_parent`), which undid the hand-off.
// This leaves the page with no key it saw go down, because it gets a keydown only after this frame's listener does. The one gap is a key that went down before this script started.

// One cancelled keydown that may reach the page later, on replay.
export type HeldPress = { keyup_seen: boolean };

export function create_cancelled_keys() {
  const codes = new Set<string>();
  const presses = new Map<string, HeldPress>();
  // Codes whose keydown reached this frame, cancelled or not. A code stays when its keyup lands in another frame, and the next keyup of that key here then passes. A stale code errs that way so it never hides a keyup the page waits for.
  const seen_down = new Set<string>();
  return {
    // Called for every keydown, before `on_keydown` skips any. A modifier makes no key token, yet the page gets its keydown and must get its keyup.
    saw_keydown_: (code: string) => seen_down.add(code),
    // A passed keydown clears the code. The keyup of an earlier cancelled press can land in
    // another tab (a tab switch), and a stale code would eat the next typed letter.
    record_keydown_: (code: string, decision: "cancel" | "pass", press?: HeldPress) => {
      if (decision === "cancel") {
        codes.add(code);
        if (press) presses.set(code, press);
      } else {
        codes.delete(code);
        presses.delete(code);
      }
    },
    cancels_keypress_: (code: string) => codes.has(code),
    take_keyup_: (code: string) => {
      const press = presses.get(code);
      if (press) press.keyup_seen = true;
      presses.delete(code);
      const was_cancelled = codes.delete(code);
      return !seen_down.delete(code) || was_cancelled;
    },
    // The press goes back to the page. Returns whether its keyup was already swallowed, so the caller sends one. Otherwise the key is still down, and its real keyup must reach the page.
    release_for_replay_: (code: string, press: HeldPress): boolean => {
      if (press.keyup_seen) return true;
      if (presses.get(code) === press) {
        presses.delete(code);
        codes.delete(code);
      }
      return false;
    },
  };
}
