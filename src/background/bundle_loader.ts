// Injects a bundle into a frame on request. The content script asks once per document, and a second ask
// while the first is still running joins it, so a bundle never runs twice because keys arrived during the load.

import { is_bundle_name } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { RunResponse } from "../shared/messages.ts";

// The document id tells a new page in a frame from the one it replaced, so a request from the new page never joins a load of the old one.
export type BundleTarget = { tab_id: number; frame_id: number; document_id: string };

export type BundleLoaderDeps = {
  inject: (target: BundleTarget, file: string) => Promise<void>;
  // Firefox can leave an injection into a navigating frame unanswered. Past this the load fails, so the page stops holding keys.
  timeout_ms: number;
};

// The sender of a runtime message. Firefox sets `documentId`, and the bundled types do not list it.
export type LoadSender = { tab?: { id?: number | undefined } | undefined; frameId?: number | undefined; documentId?: string | undefined };

const failure = (message: string): RunResponse => ({ ok: false, refusal: { id: "oasisfox", message } });

export function create_bundle_loader(deps: BundleLoaderDeps) {
  const in_flight = new Map<string, Promise<RunResponse>>();

  async function inject_with_deadline(target: BundleTarget, name: BundleName): Promise<RunResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<RunResponse>((resolve) => {
      timer = setTimeout(() => resolve(failure(`OasisFox could not load ${name}: no answer in ${deps.timeout_ms} ms`)), deps.timeout_ms);
    });
    const injected = deps
      .inject(target, `${name}.js`)
      .then((): RunResponse => ({ ok: true }))
      .catch((error: unknown) => failure(`OasisFox could not load ${name}: ${error instanceof Error ? error.message : String(error)}`));
    try {
      return await Promise.race([injected, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  function load(target: BundleTarget, name: BundleName): Promise<RunResponse> {
    const key = `${target.tab_id}:${target.frame_id}:${target.document_id}:${name}`;
    const joined = in_flight.get(key);
    if (joined) return joined;
    const attempt = inject_with_deadline(target, name).finally(() => {
      if (in_flight.get(key) === attempt) in_flight.delete(key);
    });
    in_flight.set(key, attempt);
    return attempt;
  }

  return {
    load,
    // The entry for a `load_bundle` message. The name is checked here because the sender is a page script.
    answer: (sender: LoadSender, name: unknown): Promise<RunResponse> => {
      if (sender.tab?.id === undefined || !is_bundle_name(name)) return Promise.resolve(failure("OasisFox: unknown bundle request"));
      return load({ tab_id: sender.tab.id, frame_id: sender.frameId ?? 0, document_id: sender.documentId ?? "" }, name);
    },
  };
}
