import { define } from "../shared/registry/builtin.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { SidebarCommandId } from "../shared/browser_module_protocol.ts";

// The keys of the sidebar mode. The browser module runs them in Firefox's own sidebar, from the table the extension writes into its state (`sidebar_rows_of`). The extension has no focus there, so a run from the extension always refuses.
// The `satisfies` clause keeps this table and the module's command list the same set.
const SIDEBAR_COMMANDS = {
  "sidebar.down": { name: "sidebar_down", label: "Next row", intent: "Move to the next row of a sidebar list or vertical tabs." },
  "sidebar.up": { name: "sidebar_up", label: "Previous row", intent: "Move to the previous row of a sidebar list or vertical tabs." },
  "sidebar.first": { name: "sidebar_first", label: "First row", intent: "Move to the first row of a sidebar list or vertical tabs." },
  "sidebar.last": { name: "sidebar_last", label: "Last row", intent: "Move to the last row of a sidebar list or vertical tabs." },
  "sidebar.open": { name: "sidebar_open", label: "Open the row", intent: "Open the focused row of a sidebar list or vertical tabs." },
  "sidebar.expand": { name: "sidebar_expand", label: "Expand the row", intent: "Open the focused folder or group in the sidebar." },
  "sidebar.collapse": { name: "sidebar_collapse", label: "Collapse the row", intent: "Fold the focused folder or group in the sidebar." },
  "sidebar.close_item": { name: "sidebar_close_item", label: "Close the tab", intent: "Close the focused tab of the open tabs panel or the strip." },
  "sidebar.filter": { name: "sidebar_filter", label: "Filter the list", intent: "Focus the panel's search box, or open the all tabs panel." },
  "sidebar.leave": { name: "sidebar_leave", label: "Leave the sidebar", intent: "Move the focus out of the sidebar, back to the page." },
} as const satisfies Record<SidebarCommandId, { name: string; label: string; intent: string }>;

for (const [id, { name, label, intent }] of Object.entries(SIDEBAR_COMMANDS)) {
  define(id, {
    name,
    label,
    intent,
    completion: "hidden",
    modes: ["sidebar"],
    bridge: false,
    runs_in: "background",
    run: () => {
      throw new RuntimeRefusal("Works only with focus in the sidebar");
    },
  });
}
