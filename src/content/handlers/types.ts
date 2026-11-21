import type { CheckedArgs } from "../../shared/index.ts";
import type { HandlerResult } from "../bundle_host.ts";

// A content command's handler. The count rule is not here: the command definition
// holds it and each `LeafStep` carries it as `count_rule`.
export type ContentHandler = {
  // Returns nothing for done, throws for failed, or returns an Outcome or a promise of one. A command that hands control to the user stays pending until the user finishes.
  // `repeat` is true when an auto-repeat keydown started the run, false for every other source.
  run: (args: CheckedArgs, repeat: boolean) => HandlerResult;
};
