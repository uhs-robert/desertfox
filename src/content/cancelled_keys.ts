// Physical keys whose keydown was cancelled: their keypress and keyup are cancelled too.

export function create_cancelled_keys() {
  const codes = new Set<string>();
  return {
    // A passed keydown clears the code. The keyup of an earlier cancelled press can land in
    // another tab (a tab switch), and a stale code would eat the next typed letter.
    record_keydown_: (code: string, decision: "cancel" | "pass") => {
      if (decision === "cancel") codes.add(code);
      else codes.delete(code);
    },
    cancels_keypress_: (code: string) => codes.has(code),
    take_keyup_: (code: string) => codes.delete(code),
  };
}
