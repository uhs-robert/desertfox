import { create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import type { RouterDeps } from "../../src/background/router.ts";

export type Fake = { deps: RouterDeps; log: string[]; registry: ReturnType<typeof create_registry> };

export function make_fake(commands: Record<string, CommandInput>, overrides: Partial<RouterDeps> = {}): Fake {
  const registry = create_registry();
  for (const [id, input] of Object.entries(commands)) registry.define(id, input);
  const log: string[] = [];
  const deps: RouterDeps = {
    get_command: (id) => registry.get(id),
    get_enum_sources: async () => ({ search_engines: ["arch"], containers: [] }),
    active_tab: async () => ({ tab_id: 7, window_id: 1, url: "https://example.org/" }),
    has_content_script: async () => true,
    ask_selection: async () => "chosen text",
    read_clipboard: async () => "clip",
    has_permission: async () => true,
    send_to_tab: async (tab_id, message) => void log.push(`send ${tab_id} ${JSON.stringify(message)}`),
    show_refusal: async (tab_id, refusal) => void log.push(`refuse ${tab_id} ${refusal.message}`),
    ...overrides,
  };
  return { deps, log, registry };
}
