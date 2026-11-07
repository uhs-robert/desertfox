import { create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import type { RouterDeps } from "../../src/background/router.ts";

export type Fake = { deps: RouterDeps; log: string[]; registry: ReturnType<typeof create_registry>; slots: { normal?: BoundInvocation[]; private?: BoundInvocation[] } };

export function make_fake(commands: Record<string, CommandInput>, overrides: Partial<RouterDeps> = {}): Fake {
  const registry = create_registry();
  for (const [id, input] of Object.entries(commands)) registry.define(id, input);
  const log: string[] = [];
  const slots: Fake["slots"] = {};
  const deps: RouterDeps = {
    get_command: (id) => registry.get(id),
    get_enum_sources: async () => ({ search_engines: ["arch"], containers: [] }),
    active_tab: async () => ({ tab_id: 7, window_id: 1, url: "https://example.org/" }),
    get_tab: async (tab_id) => ({ tab_id, window_id: 1, url: "https://example.org/" }),
    has_content_script: async () => true,
    ask_selection: async () => "chosen text",
    runs_with_empty: async () => false,
    read_clipboard: async () => "clip",
    has_permission: async () => true,
    send_to_tab: async (tab_id, message) => void log.push(`send ${tab_id} ${JSON.stringify(message)}`),
    open_cmdline: async (tab_id, frame_id, text) => void log.push(`cmdline ${tab_id} ${frame_id} ${text}`),
    show_refusal: async (tab_id, refusal) => void log.push(`refuse ${tab_id} ${refusal.message}`),
    repeat_memory: {
      save: async (invocations, is_private) => void (slots[is_private ? "private" : "normal"] = invocations),
      load: async (is_private) => slots[is_private ? "private" : "normal"],
    },
    ...overrides,
  };
  return { deps, log, registry, slots };
}
