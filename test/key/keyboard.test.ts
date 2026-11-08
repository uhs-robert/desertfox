import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

// keyboard.py is loaded by path under python3 -I, as the session runs it. Each call prints one JSON answer.
const run_python = (body: string) => JSON.parse(execFileSync("python3", ["-I", "-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("keyboard", ${JSON.stringify(join(import.meta.dirname, "keyboard.py"))})
keyboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keyboard)
def attempt(call):
    try:
        return call()
    except keyboard.KeyRequestError as error:
        return {"error": str(error)}
${body}
`], { encoding: "utf8" }));

test("the key table gives real US codes, with Shift for capitals and symbols", () => {
  const table = run_python(`table = keyboard.key_table(keyboard.KEYMAP_PATH.read_text())
print(json.dumps({name: table.get(name) for name in ["a", "A", "1", "exclam", "minus", "underscore", "F8", "Escape", "Return", "Tab", "Next", "Prior", "BackSpace", "bracketleft", "Up", "Shift_L", "Control_L", "Alt_L"]}))`);
  assert.deepEqual(table, {
    a: [30, false], A: [30, true], 1: [2, false], exclam: [2, true], minus: [12, false], underscore: [12, true], F8: [66, false], Escape: [1, false], Return: [28, false],
    Tab: [15, false], Next: [109, false], Prior: [104, false], BackSpace: [14, false], bracketleft: [26, false], Up: [103, false], Shift_L: [42, false], Control_L: [29, false], Alt_L: [56, false],
  });
});

test("wtype args become steps: modifiers, named keys, text by character and the -d delay between characters", () => {
  const steps = run_python(`print(json.dumps(keyboard.parse_wtype_args(["-M", "ctrl", "l", "-m", "ctrl", "-d", "5", "a B", "-k", "Return", "-s", "20"])))`);
  assert.deepEqual(steps, [
    ["mod_down", "ctrl"], ["tap", "l"], ["mod_up", "ctrl"],
    ["tap", "a"], ["sleep", 5], ["tap", "space"], ["sleep", 5], ["tap", "B"],
    ["tap", "Return"], ["sleep", 20],
  ]);
});

test("a request the keyboard cannot serve fails by name", () => {
  const errors = run_python(`print(json.dumps([attempt(lambda: keyboard.parse_wtype_args(args)) for args in [["é"], ["-"], ["-x"], ["-M", "hyper"], ["-k"], ["-d", "fast"]]]))`);
  assert.deepEqual(errors.map((answer: { error: string }) => answer.error), [
    "no key for character 'é': the keyboard types ASCII only",
    "text from stdin (-) is not supported",
    "unknown option '-x'",
    "unknown modifier 'hyper'",
    "-k needs a value",
    "-d needs whole milliseconds, got 'fast'",
  ]);
});
