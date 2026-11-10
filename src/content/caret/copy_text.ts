import type { Outcome, RegisterYank } from "../../shared/messages.ts";
import { BLACK_HOLE_REGISTER } from "../../shared/register_names.ts";

// The clipboard is missing on a plain http page and refuses a write the browser does not allow, so a copy can fail.
export async function copy_text(clipboard: { writeText: (text: string) => Promise<void> } | undefined, text: string): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Every yank goes through here: the clipboard, then the unnamed register and the one that `"<reg>` named. The black hole copies nowhere.
export async function copy_yank(clipboard: Parameters<typeof copy_text>[0], text: string, register: string | undefined): Promise<Outcome> {
  if (register === BLACK_HOLE_REGISTER) return { ok: true };
  if (!(await copy_text(clipboard, text))) return { ok: false, message: "Could not copy to the clipboard" };
  const stored = (await browser.runtime.sendMessage({ type: "register_yank", name: register ?? "", text } satisfies RegisterYank).catch(() => undefined)) as Outcome | undefined;
  return stored ?? { ok: false, message: "DesertFox background did not answer" };
}

// The copy settles later, so the user may have left visual mode meanwhile. Then only the toast is left to do.
// A refused copy answers failed and shows nothing, so the caller shows it once.
export async function yank_text(
  clipboard: Parameters<typeof copy_text>[0],
  text: string,
  register: string | undefined,
  steps: { is_same_session_: () => boolean; toast: (message: string) => void; leave_visual_: () => void },
): Promise<Outcome> {
  const copied = await copy_yank(clipboard, text, register);
  if (!copied.ok) return copied;
  steps.toast(`Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}`);
  if (steps.is_same_session_()) steps.leave_visual_();
  return { ok: true };
}
