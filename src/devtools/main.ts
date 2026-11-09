import { run_page } from "./hand_off.ts";

run_page({
  tab_id: browser.devtools.inspectedWindow.tabId,
  connect: () => browser.runtime.connect({ name: "devtools_inspect" }),
  evaluate: (expression) => browser.devtools.inspectedWindow.eval(expression),
  schedule: (action, ms) => void setTimeout(action, ms),
});
