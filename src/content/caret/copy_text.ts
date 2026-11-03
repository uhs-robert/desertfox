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

// The copy settles later, so the user may have left visual mode meanwhile. Then only the toast is left to do.
export async function yank_text(
  clipboard: Parameters<typeof copy_text>[0],
  text: string,
  steps: { is_same_session: () => boolean; toast: (message: string) => void; leave_visual: () => void },
): Promise<void> {
  if (!(await copy_text(clipboard, text))) return steps.toast("Could not copy to the clipboard");
  steps.toast(`Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}`);
  if (steps.is_same_session()) steps.leave_visual();
}
