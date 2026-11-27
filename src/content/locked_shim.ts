// The `browser` global of DesertFox's own page code on a locked page (about:addons, about:preferences, the PDF viewer, Reader View). There the browser module runs `content.js` and the bundles in a sandbox that has no extension API (docs/firefox-behavior.md, "Locked pages").
// The module puts its transport on the sandbox as `desertfox_locked_transport`, runs this file, then `content.js`. This file takes the transport off the global and gives the page code the typed surface it uses (`MessagingBrowser`), nothing more.
// Every message goes past the allow list (`LOCKED_PAGE_ROUTES`) and a size cap here, and again in the background (`browser_module_rpc.ts`), which never trusts this file.

import type { PageAnswer, SnapshotPart } from "../shared/browser_module_protocol.ts";
import { EXTENSION_TO_MODULE_KINDS, json_bytes, locked_route_of, MESSAGE_ENVELOPE_BYTES, MODULE_TO_EXTENSION_KINDS, validate_snapshot } from "../shared/browser_module_protocol.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../shared/storage_watch.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";

// What the module gives. `call` sends a page call and settles with its answer text. `snapshot` returns the module's cached copy of a part. `on_push` hears each push and sends back the answer text the listener gives.
type Transport = {
  extension_id: string;
  base_url: string;
  alive: () => boolean;
  call: (message: string) => Promise<string>;
  load_bundle: (name: string) => Promise<unknown>;
  snapshot: (part: SnapshotPart) => unknown;
  on_snapshot: (listener: (part: SnapshotPart) => void) => void;
  on_push: (listener: (message: string) => Promise<string>) => void;
};

type Listener = (...args: never[]) => unknown;

const GONE = "Extension context invalidated.";
// The text of a page message rides inside an envelope, so it gets the kind's limit less the envelope.
const CALL_TEXT_BYTES = MODULE_TO_EXTENSION_KINDS["page_call"]!.max_bytes! - MESSAGE_ENVELOPE_BYTES;
const ANSWER_TEXT_BYTES = MODULE_TO_EXTENSION_KINDS["page_answer"]!.max_bytes! - MESSAGE_ENVELOPE_BYTES;
const PUSH_TEXT_BYTES = EXTENSION_TO_MODULE_KINDS["page_push"]!.max_bytes!;
// The two `storage.local` keys the page code reads, each served from its snapshot.
const LOCAL_PARTS: Record<string, SnapshotPart> = { [CONFIG_STATUS_STORAGE_KEY]: "config", [THEME_STORAGE_KEY]: "theme" };

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function locked_browser(transport: Transport) {
  const message_listeners = new Set<Listener>();
  const change_listeners = new Set<Listener>();
  const alive = (): boolean => transport.alive();

  const snapshot_value = (part: SnapshotPart): unknown => {
    const checked = validate_snapshot(part, transport.snapshot(part));
    return checked.ok ? checked.value.value : undefined;
  };

  async function call(message: unknown): Promise<unknown> {
    const text = JSON.stringify(message);
    if ((json_bytes(text) ?? Number.POSITIVE_INFINITY) > CALL_TEXT_BYTES) throw new Error("the message is too large for a locked page");
    let answer: unknown;
    try {
      answer = JSON.parse(await transport.call(text));
    } catch (error) {
      throw error instanceof SyntaxError ? new Error("the answer is not JSON") : error;
    }
    if (!is_record(answer)) throw new Error("the answer is not a table");
    if (typeof answer.error === "string") throw new Error(answer.error);
    return answer.value;
  }

  async function send_message(message: unknown): Promise<unknown> {
    if (!alive()) throw new Error(GONE);
    const type = is_record(message) ? message.type : undefined;
    const route = locked_route_of(type);
    if (route === "module") return transport.load_bundle(String((message as { name?: unknown }).name));
    if (route === "snapshot") return snapshot_value("keymap");
    if (type === "list_keys" && is_root_panel(message as Record<string, unknown>)) {
      const panel = snapshot_value("which_key");
      if (panel !== undefined) return panel;
    }
    if (route !== "background") throw new Error(`${String(type)} is not sent from a locked page`);
    return call(message);
  }

  // As Firefox does: the first listener that answers with a promise, or returns true and calls `respond`, gives the answer. The rest return undefined for types they do not own.
  function deliver(message: unknown): Promise<unknown> | undefined {
    const sender = { id: transport.extension_id };
    for (const listener of [...message_listeners]) {
      let respond: (value: unknown) => void = () => undefined;
      const responded = new Promise<unknown>((resolve) => (respond = resolve));
      const result = (listener as (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown)(message, sender, respond);
      if (result === true) return responded;
      // A thenable, not `instanceof Promise`: a listener's promise may come from another global.
      if (typeof (result as { then?: unknown } | undefined)?.then === "function") return Promise.resolve(result);
    }
    return undefined;
  }

  async function answer_push(text: string): Promise<string> {
    const answer = await answer_of(() => {
      if (!alive()) throw new Error(GONE);
      if ((json_bytes(text) ?? Number.POSITIVE_INFINITY) > PUSH_TEXT_BYTES) throw new Error("the push is too large");
      const message: unknown = JSON.parse(text);
      if (!is_record(message) || typeof message.type !== "string") throw new Error("a push needs a type");
      return deliver(message);
    });
    const answer_text = JSON.stringify(answer);
    return (json_bytes(answer_text) ?? Number.POSITIVE_INFINITY) > ANSWER_TEXT_BYTES ? JSON.stringify({ error: "the answer is too large" } satisfies PageAnswer) : answer_text;
  }

  transport.on_push(answer_push);
  // A snapshot change reaches the page code as the storage change, or for the keymap as the push, that the background would send a web page.
  transport.on_snapshot((part) => {
    if (!alive()) return;
    if (part === "keymap") return void deliver({ type: "tree_updated" });
    const key = Object.keys(LOCAL_PARTS).find((name) => LOCAL_PARTS[name] === part);
    if (key === undefined) return;
    const changes = { [key]: { newValue: snapshot_value(part) } };
    for (const listener of [...change_listeners]) (listener as (changes: unknown, area: string) => void)(changes, "local");
  });

  const event = (listeners: Set<Listener>) => ({
    addListener: (listener: Listener) => void listeners.add(listener),
    removeListener: (listener: Listener) => void listeners.delete(listener),
    hasListener: (listener: Listener) => listeners.has(listener),
  });

  return {
    runtime: {
      // Undefined once the extension unloads, as in a content script, so `extension_context_alive` stops the page code.
      get id(): string | undefined {
        return alive() ? transport.extension_id : undefined;
      },
      getURL: (path: string): string => transport.base_url + path.replace(/^\//, ""),
      // The module runs only in the top frame.
      getFrameId: (): number => 0,
      sendMessage: send_message,
      onMessage: event(message_listeners),
    },
    storage: {
      local: {
        async get(keys: unknown): Promise<Record<string, unknown>> {
          if (!alive()) throw new Error(GONE);
          const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? (keys as unknown[]) : undefined;
          if (names === undefined || names.some((name) => typeof name !== "string" || !Object.hasOwn(LOCAL_PARTS, name))) throw new Error("a locked page reads only the config status and the theme");
          const found: Record<string, unknown> = {};
          for (const name of names as string[]) {
            const value = snapshot_value(LOCAL_PARTS[name]!);
            if (value !== undefined) found[name] = value;
          }
          return found;
        },
      },
      onChanged: event(change_listeners),
    },
  };
}

// The which-key panel of normal mode with no prefix, the one part of `list_keys` a snapshot holds.
const is_root_panel = (message: Record<string, unknown>): boolean => message.mode === "normal" && Array.isArray(message.prefix) && message.prefix.length === 0;

async function answer_of(run: () => Promise<unknown> | undefined): Promise<PageAnswer> {
  try {
    return { value: await run() };
  } catch (error) {
    // Not `instanceof Error`, for the reason `deliver` names.
    const message = (error as { message?: unknown } | undefined)?.message;
    return { error: typeof message === "string" ? message : String(error) };
  }
}

const scope = globalThis as { desertfox_locked_transport?: Transport; browser?: unknown };
const module_transport = scope.desertfox_locked_transport;
delete scope.desertfox_locked_transport;
if (module_transport !== undefined) scope.browser = locked_browser(module_transport);
