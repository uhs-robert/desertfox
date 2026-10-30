import type { CheckedArgs, CountBehavior } from "../../shared/index.ts";
import type { ContentContextSource } from "../context.ts";

// A content command's handler plus the two rules the content bundle cannot read
// from the registry. The definition file in `src/commands` uses the same object,
// so each rule lives in one place.
export type ContentHandler = {
  run: (args: CheckedArgs) => void;
  count: CountBehavior;
  // Params the handler fills from the page when the invocation leaves them out.
  fill_from_page?: Record<string, ContentContextSource>;
};
