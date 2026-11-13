// Draws the banner at the top of the settings page while a host start waits on the user (`host_start_model.ts`): what using the config folder would change, an export of the browser copy, and the two choices.

import { el } from "./render.ts";
import { button, download } from "./transfer_page.ts";
import { create_transfer_session } from "./transfer_model.ts";
import type { TransferDeps } from "./transfer_model.ts";
import type { HostFileChange } from "../shared/messages.ts";
import type { HostStartSession } from "./host_start_model.ts";

const CHANGE_TEXT: Record<HostFileChange["kind"], string> = {
  replaced: "replaced by the folder's version",
  added: "added from the folder",
  removed: "dropped, it is only in the browser",
};

// `send` serves the export, which is the transfer section's own: it zips the stored files, which are the browser copy while the question is open.
export function mount_host_start(container: HTMLElement, session: HostStartSession, send: TransferDeps["send"]): () => void {
  const export_message = el("div", "desertfox-settings-message");
  const exporter = create_transfer_session({ send, on_change: () => (export_message.textContent = exporter.state.message?.text ?? "") });
  const draw = () => {
    const { pending, message, problems, busy } = session.state;
    const outcome = el("div", "desertfox-settings-message", message?.text ?? "");
    outcome.setAttribute("role", "status");
    outcome.classList.toggle("desertfox-settings-error", message?.ok === false);
    const problem_lines = problems.map((problem) => el("div", "desertfox-settings-error", problem));
    if (!pending) {
      container.replaceChildren(...(message ? [outcome, ...problem_lines] : []));
      return;
    }
    container.replaceChildren(
      el("h2", undefined, "The config folder differs from the browser copy"),
      el("p", undefined, "The native host reads ", el("code", undefined, pending.config_dir), ". Its files differ from the config files stored in the browser, which stay in force until you choose. Using the folder changes these files:"),
      el("ul", undefined, ...pending.changes.map(({ path, kind }) => el("li", undefined, el("code", undefined, path), `: ${CHANGE_TEXT[kind]}`))),
      el("p", undefined, "Your saved edits stay on top either way. To keep the browser files in the folder, export them, unpack the zip into the folder, then use the folder. The zip carries your saved edits in its settings file too, so the folder then holds them as well."),
      el(
        "div",
        "desertfox-settings-body",
        button("Export config", () => void exporter.export_zip("config").then((file) => file && download(file))),
        button("Use the folder", () => void session.choose("use_folder"), busy),
        button("Keep the browser copy", () => void session.choose("keep_browser"), busy),
      ),
      export_message,
      outcome,
      ...problem_lines,
    );
  };
  return draw;
}
