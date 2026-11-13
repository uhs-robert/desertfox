// Draws the banner at the top of the settings page while a host start waits on the user (`host_start_model.ts`): what using the config folder would change, an export of the browser copy, and the two choices.

import { el } from "./render.ts";
import { button, download } from "./transfer_page.ts";
import { create_transfer_session } from "./transfer_model.ts";
import type { TransferDeps } from "./transfer_model.ts";
import type { HostFileChange } from "../shared/messages.ts";
import type { HostStartSession } from "./host_start_model.ts";

const CHANGE_TEXT: Record<HostFileChange["kind"], string> = {
  replaced: "replaced by the version in the folder",
  added: "added from the folder",
  removed: "dropped, because only Firefox has it",
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
      el("h2", undefined, "Your settings files and the settings stored in Firefox differ"),
      el("p", undefined, "DesertFox found settings files in ", el("code", undefined, pending.config_dir), ", read by the native host, a small helper program DesertFox installs on Linux. They differ from the settings DesertFox already has. Nothing changes until you choose. If you use the folder, these files change:"),
      el("ul", undefined, ...pending.changes.map(({ path, kind }) => el("li", undefined, el("code", undefined, path), `: ${CHANGE_TEXT[kind]}`))),
      el("p", undefined, "Your changes on the Settings page are kept either way. To keep what Firefox has, press Export settings, unpack the zip into the folder, then press Use the files in the folder."),
      el(
        "div",
        "desertfox-settings-body",
        button("Export settings", () => void exporter.export_zip("config").then((file) => file && download(file))),
        button("Use the files in the folder", () => void session.choose("use_folder"), busy),
        button("Keep what Firefox has", () => void session.choose("keep_browser"), busy),
      ),
      export_message,
      outcome,
      ...problem_lines,
    );
  };
  return draw;
}
