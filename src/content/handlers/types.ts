import type { CheckedArgs } from "../../shared/index.ts";
import type { HandlerResult } from "../bundle_host.ts";

// A content command's handler plus the rule the content bundle cannot read
// from the registry. The definition file in `src/commands` uses the same object,
// so each rule lives in one place.
export type ContentHandler = {
  // Returns nothing for done, throws for failed, or returns an Outcome or a promise of one. A command that hands control to the user stays pending until the user finishes.
  // `repeat` is true when an auto-repeat keydown started the run, false for every other source.
  run: (args: CheckedArgs, repeat: boolean) => HandlerResult;
};
