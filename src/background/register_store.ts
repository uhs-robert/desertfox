// The registers: named places that hold text or a recorded list of invocations. The background owns them and every tab reaches them by message, so no page keeps a copy that could
// go stale. A normal window keeps its registers in `storage.local`. A private window keeps its own in `storage.session`, apart from the normal ones, and loses them with its last window.

import { RuntimeRefusal } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { RegisterItem, RegisterRequest } from "../shared/messages.ts";
import { CLIPBOARD_REGISTER, register_kind, SEARCH_DIRECTION_REGISTER, SEARCH_QUERY_REGISTER, storage_name, UNNAMED_REGISTER } from "../shared/register_names.ts";
import { REGISTER_PRIVATE_STORAGE_PREFIX, REGISTER_STORAGE_PREFIX } from "./storage_keys.ts";

export type RegisterValue = string | BoundInvocation[];

export type RegisterArea = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

export type RegisterStoreDeps = {
  local: () => RegisterArea;
  session: () => RegisterArea;
  clipboard: { read: () => Promise<string>; write: (text: string) => Promise<void> };
};

const is_register_value = (value: unknown): value is RegisterValue =>
  typeof value === "string" || (Array.isArray(value) && value.every((step) => typeof (step as { id?: unknown } | null)?.id === "string"));

// Listed in this order, as vim lists them: the unnamed one, the named ones, then the search.
const LISTED_ORDER = [UNNAMED_REGISTER, ..."abcdefghijklmnopqrstuvwxyz", SEARCH_QUERY_REGISTER, SEARCH_DIRECTION_REGISTER];

const PREVIEW_CHARS = 40;

// One line for a list row. A macro shows its step count, never its steps.
export function describe_value(value: RegisterValue): string {
  if (typeof value !== "string") return `${value.length} ${value.length === 1 ? "step" : "steps"}`;
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

export function create_register_store(deps: RegisterStoreDeps) {
  const area_of = (is_private: boolean) => (is_private ? deps.session() : deps.local());
  const key_of = (name: string, is_private: boolean) => (is_private ? REGISTER_PRIVATE_STORAGE_PREFIX : REGISTER_STORAGE_PREFIX) + storage_name(name);

  const refuse_unknown = (name: string): never => {
    throw new RuntimeRefusal(`No register named ${name}`);
  };

  async function read_stored(name: string, is_private: boolean): Promise<RegisterValue | undefined> {
    const key = key_of(name, is_private);
    const stored = (await area_of(is_private).get(key))[key];
    return is_register_value(stored) ? stored : undefined;
  }

  // Each write reads, edits and writes one key, so two appends from two tabs must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const in_turn = <Result>(job: () => Promise<Result>): Promise<Result> => {
    const turn = queue.then(job, job);
    queue = turn.catch(() => undefined);
    return turn;
  };

  async function read(name: string, is_private: boolean): Promise<RegisterValue | undefined> {
    const kind = register_kind(name);
    if (kind === undefined) return refuse_unknown(name);
    if (kind === "black_hole") return undefined;
    if (kind === "clipboard") return deps.clipboard.read();
    return read_stored(name, is_private);
  }

  async function write_now(name: string, value: RegisterValue, is_private: boolean): Promise<void> {
    const kind = register_kind(name);
    if (kind === undefined) return refuse_unknown(name);
    if (kind === "black_hole") return;
    if (kind === "clipboard") {
      if (typeof value !== "string") throw new RuntimeRefusal("The clipboard register holds text only");
      return deps.clipboard.write(value);
    }
    let kept = value;
    if (kind === "append") {
      const before = await read_stored(name, is_private);
      if (before !== undefined && typeof before !== typeof value) throw new RuntimeRefusal(`Register ${storage_name(name)} holds ${typeof before === "string" ? "text" : "a macro"}, so ${typeof value === "string" ? "text" : "steps"} cannot join it`);
      if (typeof before === "string") kept = before + (value as string);
      else if (before !== undefined) kept = [...before, ...(value as BoundInvocation[])];
    }
    await area_of(is_private).set({ [key_of(name, is_private)]: kept });
  }

  // Every name listed and offered for completion, with a short preview. `+` shows the clipboard and `_` never has a value, so it is left out.
  async function items(is_private: boolean): Promise<RegisterItem[]> {
    const area = area_of(is_private);
    const keys = LISTED_ORDER.map((name) => key_of(name, is_private));
    const stored = await area.get(keys);
    const rows: RegisterItem[] = LISTED_ORDER.flatMap((name, index) => {
      const value = stored[keys[index] as string];
      return is_register_value(value) ? [{ name, description: describe_value(value) }] : [];
    });
    const clipboard = await deps.clipboard.read().catch(() => "");
    return clipboard === "" ? rows : [...rows, { name: CLIPBOARD_REGISTER, description: describe_value(clipboard) }];
  }

  return {
    read,
    write: (name: string, value: RegisterValue, is_private: boolean) => in_turn(() => write_now(name, value, is_private)),
    items,
    // Drops every private register unless a private window is open. The window check runs in the queue, so a write from a window that just opened is never deleted.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (await has_private_window()) return;
        const area = deps.session();
        const private_keys = Object.keys(await area.get(null)).filter((key) => key.startsWith(REGISTER_PRIVATE_STORAGE_PREFIX));
        if (private_keys.length > 0) await area.remove(private_keys);
      }),
  };
}

export type RegisterStore = ReturnType<typeof create_register_store>;

// Calls the browser at use, so the command modules load in Node for the commands.json build.
export const browser_register_store = create_register_store({
  local: () => browser.storage.local,
  session: () => browser.storage.session,
  clipboard: { read: () => navigator.clipboard.readText(), write: (text) => navigator.clipboard.writeText(text) },
});

// The last private window closed, or none was open when the background started: nothing private may stay.
export const forget_private_registers_without_window = (store: RegisterStore, has_private_window: () => Promise<boolean>): Promise<void> => store.clear_private_without_window(has_private_window);

// Cleans up at start and after every window closes. A failed cleanup only leaves private values until the next one, so it warns and goes on.
export function wire_private_register_cleanup(store: RegisterStore, windows: { onRemoved: { addListener: (listener: () => void) => void }; getAll: () => Promise<{ incognito: boolean }[]> }): void {
  const has_private_window = async () => (await windows.getAll()).some((window) => window.incognito);
  const clean = () => void forget_private_registers_without_window(store, has_private_window).catch((error: unknown) => console.warn("desertfox: could not clear the private registers", error));
  windows.onRemoved.addListener(clean);
  clean();
}

// A register message from a content script. The page's privacy is the sender tab's, never the message's. Only a tab sends these.
export async function answer_register_request(store: RegisterStore, request: RegisterRequest, tab: { incognito: boolean } | undefined): Promise<RegisterValue | undefined | { ok: boolean; message?: string }> {
  if (!tab || typeof request.name !== "string") return undefined;
  if (request.type === "register_read") return store.read(request.name, tab.incognito).catch(() => undefined);
  if (typeof request.text !== "string") return { ok: false, message: "A register write needs text" };
  return store.write(request.name, request.text, tab.incognito).then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
  );
}
