import "./command_modules.ts";
import type { ContentToBackground } from "../shared/messages.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { make_router_deps, reinject_deps } from "./browser_deps.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { create_router } from "./router.ts";
import { SLOT_TABLE_STORAGE_KEY } from "./storage_keys.ts";
import { get_config, get_search_engine_names } from "./startup.ts";
import type { SlotTable } from "./slots.ts";

const router = create_router(make_router_deps(get_search_engine_names));

// Listeners register in the first turn, so no event is missed while the config loads.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const request = message as ContentToBackground;
  if (request?.type !== "run") return undefined;
  return get_config().then(() =>
    router.run({
      invocations: request.invocations,
      mode: request.mode,
      ...(sender.tab?.id === undefined ? {} : { sender_tab_id: sender.tab.id }),
      ...(sender.frameId === undefined ? {} : { frame_id: sender.frameId }),
    }),
  );
});

browser.commands.onCommand.addListener(async (slot_name: string) => {
  await get_config();
  const stored = await browser.storage.local.get(SLOT_TABLE_STORAGE_KEY);
  const invocations: BoundInvocation[] | undefined = (stored[SLOT_TABLE_STORAGE_KEY] as SlotTable | undefined)?.[slot_name];
  if (invocations) await router.run({ invocations, mode: "normal" });
});

void get_config().then(() => repair_tabs_after_reload(reinject_deps));
