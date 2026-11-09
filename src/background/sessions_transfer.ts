// The settings page's sessions export and import. The page downloads and reads the file itself, so this answers with text and takes text.

import { RuntimeRefusal } from "../shared/command.ts";
import type { ConfigImportAnswer, ExportSessions, ExportSessionsAnswer, ImportSessions } from "../shared/messages.ts";
import type { SessionStore } from "./session_store.ts";

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export async function answer_sessions_transfer(request: ExportSessions | ImportSessions, store: Pick<SessionStore, "export_json" | "import_json">): Promise<ExportSessionsAnswer | ConfigImportAnswer> {
  try {
    if (request.type === "export_sessions") return { ok: true, ...(await store.export_json()) };
    if (typeof request.text !== "string") return { ok: false, message: "Sessions not imported: the request has no file text." };
    const { added, skipped } = await store.import_json(request.text);
    const skipped_note = skipped.length === 0 ? "" : `, skipped ${plural(skipped.length, "entry")} (${skipped.map((name) => `"${name}"`).join(", ")}) that are no session or have a name that starts with - or @`;
    if (added.length === 0) return { ok: false, message: `Sessions not imported: the file holds no session to add${skipped_note}.` };
    return { ok: true, message: `Imported ${plural(added.length, "session")} (${added.map((name) => `"${name}"`).join(", ")})${skipped_note}.` };
  } catch (error) {
    return { ok: false, message: error instanceof RuntimeRefusal ? `Sessions not imported: ${error.message}.` : `Sessions not imported: ${message_of(error)}` };
  }
}
