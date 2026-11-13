// The Quickmarks section's messages over the `M` store's normal-window layer. The store is the one writer, so `M`, the form and `go<key>` never disagree.

import type { QuickmarkTable } from "../shared/quickmark_names.ts";
import type { ChangeQuickmarks, ChangeQuickmarksAnswer, ListQuickmarksAnswer, QuickmarkRow } from "../shared/messages.ts";
import { failure } from "./config_reload.ts";
import type { QuickmarkStore } from "./quickmark_store.ts";

export type QuickmarkMessageDeps = {
  store: Pick<QuickmarkStore, "add" | "remove" | "saved">;
  // The quickmarks.toml table in force.
  configured: () => Promise<QuickmarkTable>;
};


export function create_quickmark_messages(deps: QuickmarkMessageDeps) {
  async function list(): Promise<ListQuickmarksAnswer> {
    try {
      const saved = await deps.store.saved(false);
      const rows: QuickmarkRow[] = Object.entries({ ...(await deps.configured()), ...saved }).map(([key, url]) => ({ key, url, saved: Object.hasOwn(saved, key) }));
      return { ok: true, quickmarks: rows.sort((a, b) => a.key.localeCompare(b.key)) };
    } catch (error) {
      return failure(error);
    }
  }

  async function change(request: ChangeQuickmarks): Promise<ChangeQuickmarksAnswer> {
    try {
      if (request.action === "set") {
        if (String(request.url).trim() === "") return { ok: false, message: "Quickmark not saved: give an address." };
        await deps.store.add(String(request.key), String(request.url), false);
        return { ok: true, message: `Saved the quickmark ${request.key}.` };
      }
      if (request.action === "remove") {
        await deps.store.remove(String(request.key), false);
        return { ok: true, message: `Removed the quickmark ${request.key}.` };
      }
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
