// Type-only check, run by `npm run typecheck`. Nothing calls the function.
import type { ArgsOf } from "../src/shared/command.ts";
import { define } from "../src/shared/registry/builtin.ts";

export function misspelled_param_field_is_rejected(): void {
  define("typed.probe", {
    bridge: false,
    label: "Probe",
    intent: "Probe.",
    runs_in: "background",
    // @ts-expect-error `whn` is not a field of a param.
    params: [{ name: "n", type: "int", default: 1, whn: { side: ["none"] } }],
    run: () => {},
  });
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assert_type<_T extends true>(): void {}

const optional_enum = [{ name: "where", type: "enum", values: ["a", "b"], optional: true }] as const;
const required_enum = [{ name: "where", type: "enum", values: ["a", "b"] }] as const;
const arms_only_bool = [{ name: "flag", type: "bool", default: [{ value: true, when: { mode: ["x"] } }] }] as const;
const arms_then_value_bool = [{ name: "flag", type: "bool", default: [{ value: true, when: { mode: ["x"] } }, false] }] as const;

export function arg_types_follow_the_validator(): void {
  assert_type<Equal<ArgsOf<typeof optional_enum>["where"], "a" | "b" | "">>();
  assert_type<Equal<ArgsOf<typeof required_enum>["where"], "a" | "b">>();
  assert_type<Equal<ArgsOf<typeof arms_only_bool>["flag"], boolean | undefined>>();
  assert_type<Equal<ArgsOf<typeof arms_then_value_bool>["flag"], boolean>>();
}
