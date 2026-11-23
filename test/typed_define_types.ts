// Type-only check, run by `npm run typecheck`. Nothing calls the function.
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
