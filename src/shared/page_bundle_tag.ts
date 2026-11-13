// The extension pages' half of a bundle load. Firefox refuses `executeScript` on a `moz-extension://` page, so the background asks the page to add the `<script src>` tag itself.

import { BUNDLE_NAMES } from "./bundles.ts";
import type { AddBundleScript, AddBundleScriptAnswer } from "./messages.ts";

// A bundle file is added once, and a request that arrives while the tag loads joins it. A failed tag is removed and forgotten, so a later request tries again.
export function create_bundle_tag_adder(doc: Document) {
  const loading = new Map<string, Promise<void>>();
  return (file: string): Promise<void> => {
    const joined = loading.get(file);
    if (joined) return joined;
    const attempt = new Promise<void>((resolve, reject) => {
      const tag = doc.createElement("script");
      tag.src = file;
      tag.onload = () => resolve();
      tag.onerror = () => {
        tag.remove();
        loading.delete(file);
        reject(new Error(`${file} did not load`));
      };
      doc.head.append(tag);
    });
    loading.set(file, attempt);
    return attempt;
  };
}

// The answer waits for the script to run, so the caller's next step finds the handler registered.
export async function answer_bundle_request(add_tag: (file: string) => Promise<void>, message: AddBundleScript): Promise<AddBundleScriptAnswer> {
  if (!BUNDLE_NAMES.some((name) => `${name}.js` === message.file)) return { ok: false, message: `${message.file} is not a bundle` };
  try {
    await add_tag(message.file);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function listen_for_bundle_requests(): void {
  const add_tag = create_bundle_tag_adder(document);
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = raw as AddBundleScript | undefined;
    if (message?.type === "add_bundle_script") return answer_bundle_request(add_tag, message);
    return undefined;
  });
}
