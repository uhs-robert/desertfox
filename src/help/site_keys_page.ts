// Draws the "Let this site keep some keys" form from a site keys session (`site_keys_model.ts`). It sits in the Your site rules section and takes keys by capture or from a list.

import { el } from "./render.ts";
import { button } from "./transfer_page.ts";
import { create_site_keys_session } from "./site_keys_model.ts";
import type { SiteKeysDeps, SiteKeysSession } from "./site_keys_model.ts";
import type { KeyCapture } from "./keys_page.ts";
import { touches_settings } from "../shared/storage_watch.ts";

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

export const SITE_KEYS_CAPTURE_CLASS = "desertfox-site-keys-capture";

// Draws the form into `container`. `prefill` is the site pattern the popup link carries. `stop` ends the listening and the capture, and `set_site` points the form at another site.
export function mount_site_keys(container: HTMLElement, deps: Omit<SiteKeysDeps, "on_change">, prefill: string | undefined, capture: KeyCapture, storage_changed: StorageChangedEvents): { stop: () => void; set_site: (site: string) => void } {
  let session: SiteKeysSession;

  const site = el("input", "desertfox-settings-input") as HTMLInputElement;
  site.type = "text";
  site.spellcheck = false;
  site.setAttribute("aria-label", "Site pattern");
  site.addEventListener("input", () => session.set_site(site.value));
  const site_note = el("div", "desertfox-settings-error");
  site_note.setAttribute("role", "status");

  const chips = el("div", "desertfox-site-keys-chips");
  const capture_box = el("div", `desertfox-settings-input desertfox-keys-capture ${SITE_KEYS_CAPTURE_CLASS}`);
  capture_box.tabIndex = 0;
  capture_box.setAttribute("role", "group");
  capture_box.setAttribute("aria-label", "Press a key the site keeps");
  const release_capture = capture.bind(capture_box, {
    token: (token) => session.capture(token),
    backspace: () => session.capture_backspace(),
    save: () => void session.save(),
    cancel: () => capture_box.blur(),
  });

  const text_input = el("input", "desertfox-settings-input") as HTMLInputElement;
  text_input.type = "text";
  text_input.spellcheck = false;
  text_input.setAttribute("aria-label", "Keys as text");
  text_input.addEventListener("input", () => session.set_text(text_input.value));
  const text_note = el("div", "desertfox-settings-error");
  const fold = el("details", "desertfox-site-keys-fold", el("summary", undefined, "Edit as text"), el("p", "desertfox-help-muted", "Separate keys with spaces. Write a sequence without spaces, for example gg, and a chord in angle brackets, for example <C-x>."), text_input, text_note) as HTMLDetailsElement;
  fold.addEventListener("toggle", () => session.open_text(fold.open));

  const filter = el("input", "desertfox-settings-input") as HTMLInputElement;
  filter.type = "search";
  filter.placeholder = "Filter by key or command";
  filter.setAttribute("aria-label", "Filter the keys DesertFox uses");
  filter.addEventListener("input", () => session.set_filter(filter.value));
  const picks = el("div", "desertfox-site-keys-picks");
  const pick_fold = el("details", "desertfox-site-keys-fold", el("summary", undefined, "Pick from the keys DesertFox uses here"), filter, picks);

  const effect = el("p", "desertfox-help-muted");
  const off_note = el("p", "desertfox-help-muted");
  const refusal = el("p", "desertfox-settings-error");
  refusal.setAttribute("role", "status");
  const answer = el("p", undefined);
  answer.setAttribute("role", "status");
  const save = button("Save", () => void session.save());
  const remove = button("Remove", () => void session.remove());

  container.replaceChildren(
    el("h3", undefined, "Let this site keep some keys"),
    el("p", "desertfox-help-muted", "The site gets the keys you name, for example j and k on a mail site. DesertFox leaves them alone there. Press them in the box, or pick them from the list."),
    el("label", undefined, "Site ", site),
    site_note,
    el("div", "desertfox-site-keys-line", capture_box, chips),
    effect,
    pick_fold,
    fold,
    off_note,
    refusal,
    el("div", "desertfox-site-keys-line", save, remove),
    answer,
  );

  function draw(): void {
    const view = session.view();
    if (site.value !== view.site) site.value = view.site;
    site_note.textContent = view.site_problem ?? "";
    capture_box.replaceChildren(...(view.chips.length === 0 ? [el("span", "desertfox-help-muted", "Press the keys")] : [el("span", "desertfox-help-muted", "Press more keys")]));
    chips.replaceChildren(
      ...view.chips.map((keys) => {
        const chip = el("span", "desertfox-site-keys-chip", el("kbd", undefined, keys));
        const drop = button("x", () => session.remove_chip(keys));
        drop.className = "desertfox-site-keys-drop";
        drop.setAttribute("aria-label", `Stop keeping ${keys}`);
        chip.append(drop);
        return chip;
      }),
    );
    effect.textContent = view.effect;
    if (text_input.value !== view.text) text_input.value = view.text;
    text_note.textContent = view.text_problem ?? "";
    picks.replaceChildren(
      ...(view.picks.length === 0
        ? [el("p", "desertfox-help-muted", "No keys match.")]
        : view.picks.map((row) => {
            const box = el("input", undefined) as HTMLInputElement;
            box.type = "checkbox";
            box.checked = view.chips.includes(row.keys);
            box.addEventListener("change", () => session.toggle_pick(row.keys));
            return el("label", "desertfox-site-keys-pick", box, " ", el("kbd", undefined, row.keys), " ", el("span", "desertfox-help-muted", row.command));
          })),
    );
    off_note.textContent = view.off_note ?? "";
    refusal.textContent = view.refusal ?? "";
    answer.textContent = view.message?.text ?? "";
    answer.className = view.message?.ok === false ? "desertfox-settings-error" : "desertfox-help-muted";
    save.disabled = !view.can_save;
    remove.disabled = !view.can_remove;
    remove.hidden = !view.has_row;
  }

  session = create_site_keys_session({ ...deps, on_change: draw });
  draw();
  void session.load(prefill);
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (touches_settings(changes, area)) void session.refresh();
  };
  storage_changed.addListener(listener);
  return {
    stop: () => {
      storage_changed.removeListener(listener);
      release_capture();
    },
    set_site: (next) => session.set_site(next),
  };
}
