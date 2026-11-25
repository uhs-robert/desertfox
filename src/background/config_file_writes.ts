import { warn_and_go } from "../shared/swallow.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { load_edits, load_files_source } from "../shared/config/config_load.ts";
import { engine_resolves_without_owned, ENGINE_FILE, holds_engine, owned_engines } from "./engine_file.ts";
import { KEYS_FILE, letters_in_text } from "./engine_keys_file.ts";
import { host_file_of, NativeHostError } from "./native_client.ts";
import type { ConfigFilesReply } from "./native_client.ts";
import { build_files_config, ConfigRefusal } from "./config_reload.ts";
import { css_limit_breaches } from "./css_limits.ts";
import { classify_host_start, clear_host_pending, files_digest, has_config_files, read_host_memory, remember_applied, store_host_pending } from "./host_start.ts";
import { files_before_unsynced, read_unsynced, replayed_on_folder, SETTINGS_FILE, store_unsynced, theme_named_in, default_engine_named_in, text_sha256, without_unsynced_path } from "./settings_file.ts";
import type { CopyReplacedBy, FileWriteOutcome, UnsyncedFiles } from "./settings_file.ts";
import type { ConfigStore } from "./config_store.ts";
import type { ConfigSwap } from "./config_swap.ts";
import type { Services } from "./services.ts";

type HostWriteReply = { ok: true } | { ok: false; error: unknown };

// `superseded`: the record moved to a newer base during the write, or the host refused another file of the batch in a way a new try can get past, so the write loop goes on from it.
type SettledWrite = FileWriteOutcome | { kind: "superseded" };

// One `write_config_files` call: the writes of its files, which land all or none, and the host's reply. The change queue starts it and settles its reply once, and the host call runs between the two, outside the queue.
// `settled` holds each path's outcome from the first settle, so every caller that waited on one of its paths gets the same outcomes.
type HostBatch = { writes: HostWrite[]; reply: Promise<HostWriteReply>; settled?: Promise<Map<string, SettledWrite>> };

// The write of the file at `path` in a batch (`text` null deletes it).
// `covers` and `drops` are the path's `picks_made` and `drops` at the start: the text holds every pick of the path up to `covers` made since that many drops.
type HostWrite = { path: string; base: string | null; text: string | null; covers: number; drops: number; batch: HostBatch };

// What the write loops keep for one path of the record. Each path has its own, so a drop or a write out on one file never decides another file's outcome.
// It lives in memory only, as the replies that read it do.
// A pick is numbered when it stores the record, and a swap that drops the path counts as a drop, so a pick can tell a write that holds it from one that does not.
type PathWrites = {
  // The write out now. One at a time per path: a second write against the same base would find the first one's text and be refused. A batch takes this slot for each of its files.
  out?: HostWrite;
  picks_made: number;
  drops: number;
  // The swap behind each drop: entry n dropped the record of the picks made after n drops.
  drop_causes: CopyReplacedBy[];
  // How the path's record last ended, for a pick whose write another caller settled before the pick's own turn.
  end?: FileWriteOutcome;
  // Refused writes in a row whose edits went onto the folder's new text, counted per write loop. A tool that rewrites the file all the time would otherwise keep the loop going.
  replays_in_a_row: number;
};

// What a pick's reply needs to say what became of it.
export type PickMark = { path: string; seq: number; drops: number };

// A file a write loop sends to the folder, with the pick whose outcome its caller waits for.
export type WriteItem = { path: string; pick?: PickMark };

// Runs `start` and `settle` in the change queue, or inline for a caller already in it.
export type QueueRunner = <T>(work: () => Promise<T>) => Promise<T>;

// The folder as the host reads it now, for the gate of a batch, with the count of files landed before the read.
// A failed read holds the batch, since nothing checked it. A host that is missing or not permitted waits instead, as the write itself would.
type GateFolder = ConfigFilesReply & { landed: number };

// The folder read after a refusal. `current` is false when a write settled since the read began, so the read can hold a file's text from before that write.
type FolderAfterRefusal = ConfigFilesReply & { current: boolean };

// What one queue turn of `start_batch` did. `done` holds the paths that need no write (undefined: not in the record).
// `stale`: a file landed since the gate's read. `wait`: another batch has a write out on one of the paths. `held`: the folder would not build after the batch, so nothing was sent.
// `breaking`: the paths whose write alone breaks the folder, given when the batch is held.
type BatchStart = "stale" | { done: Map<string, FileWriteOutcome | undefined>; wait?: HostBatch[]; held?: FileWriteOutcome; breaking?: string[]; batch?: HostBatch };

// The host write pipeline: the record of each path's writes, the write loop, the gate and the replay of a refused write.
// `swap` is read late because the swap itself takes `note_record_dropped` from this pipeline when it is created.
export function create_config_file_writes(parts: { store: ConfigStore; services: Services; swap: () => ConfigSwap }) {
  const { store, services } = parts;
  const { native_host } = services;
  const { built_in_commands } = store;
  const apply_files: ConfigSwap["apply_files"] = (...args) => parts.swap().apply_files(...args);
  // A name a theme file can shadow and still resolve without it: `desktop` and the built-in themes.
  const theme_resolves_without_file = (name: string): boolean => name === DESKTOP_THEME || built_in_theme_names().includes(name);

  const path_writes = new Map<string, PathWrites>();
  const MAX_REPLAYS_IN_A_ROW = 3;
  // Files landed so far, of any path: a batch of N files adds N. A folder read taken before a file landed can hold that file's old text.
  let writes_landed = 0;

  function writes_of(path: string): PathWrites {
    let writes = path_writes.get(path);
    if (!writes) path_writes.set(path, (writes = { picks_made: 0, drops: 0, drop_causes: [], replays_in_a_row: 0 }));
    return writes;
  }

  function note_record_dropped(path: string, by: CopyReplacedBy): void {
    const writes = writes_of(path);
    writes.drop_causes[writes.drops] = by;
    writes.drops += 1;
    writes.end = { kind: "replaced", by, written: false };
  }

  // Numbers a pick of the file at `path` once a swap stored it in the record. In the change queue, after that swap.
  function mark_pick(path: string): PickMark {
    const writes = writes_of(path);
    writes.picks_made += 1;
    return { path, seq: writes.picks_made, drops: writes.drops };
  }

  const already_in_queue: QueueRunner = (work) => work();

  // Writes every file the folder lags, in one batch. The files wait for unrelated reasons, so one the host fails or the gate holds goes out of the batch once and the others land without it.
  async function write_waiting_files(in_queue: QueueRunner): Promise<void> {
    const unsynced = await in_queue(read_unsynced);
    await write_files(in_queue, Object.keys(unsynced ?? {}).map((path) => ({ path })), { set_bad_file_aside: true });
  }

  // Writes the browser copy of each file of `items` while the folder lags it, all in one host call, and again for a pick made during a write. Gives each path's outcome (that of its pick, when it has one), undefined for a path that never waited.
  // The gate builds the folder as it would be after the whole batch, and the host lands the files all or none, so no order between them matters: a settings.toml can name an engine its batch adds while the batch drops the old one.
  // `set_bad_file_aside`: once, a batch the host refuses over one named file, or that the gate holds, goes again without that file, which keeps its own outcome.
  async function write_files(in_queue: QueueRunner, items: WriteItem[], { set_bad_file_aside = false } = {}): Promise<Map<string, FileWriteOutcome | undefined>> {
    const outcomes = new Map<string, FileWriteOutcome | undefined>();
    // The paths whose pick a write held that reached the folder before a swap replaced the copy.
    const picks_written = new Set<string>();
    const replaced = ({ path, pick }: WriteItem): FileWriteOutcome | undefined => {
      const writes = writes_of(path);
      return pick && writes.drops !== pick.drops ? { kind: "replaced", by: writes.drop_causes[pick.drops]!, written: picks_written.has(path) } : undefined;
    };
    for (const { path } of items) writes_of(path).replays_in_a_row = 0;
    let pending = items;
    let widened = false;
    let set_aside = !set_bad_file_aside;
    const finish = (path: string, outcome: FileWriteOutcome | undefined) => {
      outcomes.set(path, outcome);
      pending = pending.filter((item) => item.path !== path);
    };
    // A batch another caller started can hold a pick of this loop.
    const note_picks_written = (writes: HostWrite[], reply: HostWriteReply) => {
      for (const write of writes) {
        const pick = pending.find((item) => item.path === write.path)?.pick;
        if (reply.ok && pick && write.covers >= pick.seq && write.drops === pick.drops) picks_written.add(write.path);
      }
    };
    const settle_noting_picks = (batch: HostBatch) =>
      settle_batch(in_queue, batch, (shared, reply) => {
        note_picks_written(batch.writes, reply);
        return shared;
      });
    while (pending.length > 0) {
      const gate_read = await folder_for_gate(in_queue, pending);
      if (gate_read !== undefined && !is_gate_folder(gate_read)) {
        for (const item of pending) outcomes.set(item.path, replaced(item) ?? gate_read);
        break;
      }
      const started = await in_queue(() => start_batch(pending, gate_read, replaced));
      if (started === "stale") continue;
      for (const [path, outcome] of started.done) finish(path, outcome ?? outcomes.get(path) ?? (pending.find((item) => item.path === path)?.pick && writes_of(path).end));
      // It settles those writes itself rather than wait for their owners: under `,r` this loop holds the change queue, and an owner settles only in a later turn of it.
      if (started.wait) {
        for (const batch of started.wait) await settle_noting_picks(batch);
        continue;
      }
      if (started.held) {
        // A write of another file that is out can make the folder build again once it lands, so the batch tries again after it.
        const others_out = batches_out();
        if (others_out.length > 0) {
          for (const batch of others_out) await settle_noting_picks(batch);
          continue;
        }
        const breaking = started.breaking ?? [];
        if (!set_aside && breaking.length > 0 && breaking.length < pending.length) {
          set_aside = true;
          for (const path of breaking) finish(path, started.held);
          continue;
        }
        // A pick can name what only another waiting file holds, such as an engine an old host could not write yet, so the batch takes every waiting file once and tries again.
        const waiting = widened ? [] : await in_queue(waiting_paths_besides(pending));
        widened = true;
        if (waiting.length > 0) {
          pending = [...pending, ...waiting.map((path) => ({ path }))];
          continue;
        }
        for (const item of pending) outcomes.set(item.path, started.held);
        break;
      }
      if (!started.batch) continue;
      const { writes } = started.batch;
      let bad_files: string[] = [];
      const settled = await settle_batch(in_queue, started.batch, (shared, reply) => {
        note_picks_written(writes, reply);
        bad_files = set_aside ? [] : files_to_set_aside(reply);
        const mine = new Map<string, SettledWrite>();
        for (const write of writes) {
          const pick = pending.find((item) => item.path === write.path)?.pick;
          mine.set(write.path, replaced({ path: write.path, ...(pick && { pick }) }) ?? shared.get(write.path)!);
        }
        return mine;
      });
      if (bad_files.length > 0 && bad_files.length < writes.length) {
        set_aside = true;
        for (const path of bad_files) {
          const outcome = settled.get(path)!;
          if (outcome.kind !== "superseded") finish(path, outcome);
        }
        continue;
      }
      for (const write of writes) {
        const outcome = settled.get(write.path)!;
        if (outcome.kind === "superseded") continue;
        outcomes.set(write.path, outcome);
        const pick = pending.find((item) => item.path === write.path)?.pick;
        if (outcome.kind !== "written" || (pick && write.covers >= pick.seq)) finish(write.path, outcome);
      }
    }
    return outcomes;
  }

  // The files a refusal names as its own fault: the one that failed and those the rollback could not put back. None for a hand edit, which settles through the replay or the question, or for a refusal of the whole host.
  function files_to_set_aside(reply: HostWriteReply): string[] {
    if (reply.ok || !(reply.error instanceof NativeHostError) || reply.error.failure === "file_changed") return [];
    const { path, unrestored } = reply.error.refused_files;
    return path === undefined ? [] : [...new Set([path, ...unrestored])];
  }

  // The paths of the record that `items` lacks.
  const waiting_paths_besides = (items: WriteItem[]) => async (): Promise<string[]> => Object.keys((await read_unsynced()) ?? {}).filter((path) => !items.some((item) => item.path === path));

  // In the change queue. Sends the browser copy of every file of `items` that the folder lags, in one batch with one base check each.
  // A file the copy no longer has is deleted from the folder. With `folder`, a batch that breaks the folder build sends nothing and answers `held` (`write_breaks_folder`).
  async function start_batch(items: WriteItem[], folder: GateFolder | undefined, replaced: (item: WriteItem) => FileWriteOutcome | undefined): Promise<BatchStart> {
    if (is_stale(folder)) return "stale";
    const done = new Map<string, FileWriteOutcome | undefined>();
    const wait = new Set<HostBatch>();
    let unsynced = await read_unsynced();
    const { files } = await load_files_source();
    const writes: Omit<HostWrite, "batch">[] = [];
    for (const item of items) {
      const { path } = item;
      const writes_now = writes_of(path);
      const replaced_by_swap = replaced(item);
      if (replaced_by_swap) done.set(path, replaced_by_swap);
      else if (writes_now.out) wait.add(writes_now.out.batch);
      else if (!unsynced || !Object.hasOwn(unsynced, path)) done.set(path, undefined);
      else {
        const base = unsynced[path] ?? null;
        const text = files[path] ?? null;
        if (text !== null || base !== null) writes.push({ path, base, text, covers: writes_now.picks_made, drops: writes_now.drops });
        else {
          // Neither side has the file, so there is nothing to write.
          unsynced = without_unsynced_path(unsynced, path);
          await store_unsynced(unsynced);
          done.set(path, (writes_now.end = { kind: "written" }));
        }
      }
    }
    if (wait.size > 0) return { done, wait: [...wait] };
    if (writes.length === 0) return { done };
    const problem = folder && write_breaks_folder(writes, folder);
    if (folder && problem !== undefined) return { done, held: { kind: "held", problem }, breaking: writes.filter((write) => write_breaks_folder([write], folder) !== undefined).map(({ path }) => path) };
    const base_digests = await Promise.all(writes.map(({ base }) => (base === null ? null : text_sha256(base))));
    const reply = native_host.write_config_files(writes.map(({ path, text }, index) => ({ path, text, base_sha256: base_digests[index]! }))).then(
      (): HostWriteReply => ({ ok: true }),
      (error: unknown): HostWriteReply => ({ ok: false, error }),
    );
    const batch: HostBatch = { writes: [], reply };
    for (const write of writes) {
      const out: HostWrite = { ...write, batch };
      batch.writes.push(out);
      writes_of(write.path).out = out;
    }
    return { done, batch };
  }

  // The files that name what another file holds: settings.toml a theme or an engine, the page's keys file an engine.
  const NAMING_PATHS = [SETTINGS_FILE, KEYS_FILE];

  // Whether the copy's file at `path` drops what the file `namer`, at `text`, names.
  function drops_what_is_named(path: string, namer: string, text: string | null, files: ConfigFiles): boolean {
    if (namer === SETTINGS_FILE) return drops_what_settings_names(path, text, files);
    return path === ENGINE_FILE && Object.values(letters_in_text(text)).some((engine) => !holds_engine(owned_engines(files), engine) && !engine_resolves_without_owned(files, engine));
  }

  // Whether the copy's file at `path` no longer holds the theme or engine a settings.toml of `text` names, which then names nothing in the folder once `path` lands.
  function drops_what_settings_names(path: string, text: string | null, files: ConfigFiles): boolean {
    if (path === ENGINE_FILE) {
      const engine = default_engine_named_in(text);
      return engine !== undefined && !holds_engine(owned_engines(files), engine) && !engine_resolves_without_owned(files, engine);
    }
    const theme = theme_name_of_file(path);
    return files[path] === undefined && theme !== undefined && theme === theme_named_in(text) && !theme_resolves_without_file(theme);
  }

  // Waits for the host's reply to `batch`, reads the folder after a refusal, then settles every file of it in one turn of the change queue. `in_turn` runs in that same turn.
  // Any caller can settle a batch, not just the loop that started it: the first settle applies the reply once and hands every caller the same outcomes.
  async function settle_batch(in_queue: QueueRunner, batch: HostBatch, in_turn = (shared: Map<string, SettledWrite>, _reply: HostWriteReply) => shared): Promise<Map<string, SettledWrite>> {
    const reply = await batch.reply;
    const landed_before_read = writes_landed;
    const folder = changed_on_disk(reply) ? await read_folder_after_write() : undefined;
    return in_queue(async () => {
      batch.settled ??= settle_batch_reply(batch, reply, folder && { ...folder, current: writes_landed === landed_before_read });
      return in_turn(await batch.settled, reply);
    });
  }

  // The gate's read of the folder, when one of `items` is in the record.
  async function folder_for_gate(in_queue: QueueRunner, items: WriteItem[]): Promise<GateFolder | FileWriteOutcome | undefined> {
    const unsynced = await in_queue(read_unsynced);
    if (!unsynced || !items.some(({ path }) => Object.hasOwn(unsynced, path))) return undefined;
    const landed = writes_landed;
    try {
      return { ...(await native_host.read_config()), landed };
    } catch (error) {
      if (error instanceof NativeHostError && (error.failure === "no_permission" || error.failure === "host_missing")) return { kind: "waiting" };
      return { kind: "held", problem: error instanceof Error ? error.message : String(error), unread: true };
    }
  }

  // A file landed since the gate's read, so the read can hold that file's old text. The loop reads the folder again.
  const is_stale = (folder: GateFolder | undefined): boolean => folder !== undefined && folder.landed !== writes_landed;
  const is_gate_folder = (read: GateFolder | FileWriteOutcome | undefined): read is GateFolder => read !== undefined && "files" in read;

  const writes_out = (): HostWrite[] => [...path_writes.values()].flatMap((writes) => (writes.out ? [writes.out] : []));
  const batches_out = (): HostBatch[] => [...new Set(writes_out().map((write) => write.batch))];

  const with_file_text = (files: ConfigFiles, path: string, text: string | null): ConfigFiles => {
    const { [path]: _old, ...others } = files;
    return text === null ? others : { ...others, [path]: text };
  };
  const with_file_texts = (files: ConfigFiles, writes: { path: string; text: string | null }[]): ConfigFiles => writes.reduce((after, write) => with_file_text(after, write.path, write.text), files);

  function folder_build_problems(files: ConfigFiles, dir_label: string): string[] {
    try {
      build_files_config(files, dir_label, built_in_commands(), "setting");
      return [];
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      return error.problems.length > 0 ? error.problems : [error.message];
    }
  }

  // The gate of a batch: the folder after it, as far as the extension knows (the folder's files, every other write still out, then the batch's texts), must build with no problem the folder without it lacks.
  // The folder without the writes out must too, and with each batch out landed alone: the host lands two batches in either order, and one that is out can still fail, so a batch never counts on another landing. It goes once that one settled.
  // The first new problem, or undefined. One check covers every way the files can break the folder: a default engine or child they drop, a keyword they double, a settings.d file that names what they remove.
  function write_breaks_folder(writes: { path: string; text: string | null }[], folder: ConfigFilesReply): string | undefined {
    const out = writes_out();
    const each_landed_alone = batches_out().map((batch) => with_file_texts(folder.files, batch.writes));
    for (const before of out.length > 0 ? [with_file_texts(folder.files, out), folder.files, ...each_landed_alone] : [folder.files]) {
      const known = new Set(folder_build_problems(before, folder.config_dir));
      const problem = folder_build_problems(with_file_texts(before, writes), folder.config_dir).find((found) => !known.has(found));
      if (problem !== undefined) return problem;
    }
    return undefined;
  }

  const theme_name_of_file = (path: string): string | undefined => {
    const file = host_file_of(path);
    return file?.kind === "theme" ? file.name : undefined;
  };

  const changed_on_disk = (reply: HostWriteReply) => !reply.ok && reply.error instanceof NativeHostError && reply.error.failure === "file_changed";

  const read_folder_after_write = () => native_host.read_config().catch(warn_and_go("read the folder after a config file write"));

  // In the change queue. Applies the host's reply to the record of every file of the batch, once however many callers waited on it. `folder` is undefined when it could not be read.
  // A hand edit to one file refuses the whole batch, so that file settles first: the others wrote nothing, and they go again once its settle moved the record on.
  async function settle_batch_reply(batch: HostBatch, reply: HostWriteReply, folder: FolderAfterRefusal | undefined): Promise<Map<string, SettledWrite>> {
    for (const write of batch.writes) {
      const writes = writes_of(write.path);
      if (writes.out === write) delete writes.out;
      if (reply.ok) writes.replays_in_a_row = 0;
    }
    // A refused batch whose rollback could not put a file back still changed the folder, so a gate read from before it is stale.
    if (!reply.ok && reply.error instanceof NativeHostError && reply.error.refused_files.unrestored.length > 0) writes_landed += 1;
    const outcomes = new Map<string, SettledWrite>();
    const changed_path = changed_on_disk(reply) && !reply.ok ? (reply.error as NativeHostError).refused_files.path : undefined;
    const changed = batch.writes.find((write) => write.path === changed_path);
    if (changed) outcomes.set(changed.path, await outcome_of_host_write(changed, reply, folder));
    for (const write of batch.writes) if (write !== changed) outcomes.set(write.path, await outcome_of_host_write(write, reply, folder, changed && outcomes.get(changed.path)));
    return outcomes;
  }

  // `changed_outcome`: the host refused the batch over a hand edit to another of its files, and settled that file so.
  async function outcome_of_host_write(write: HostWrite, reply: HostWriteReply, folder: FolderAfterRefusal | undefined, changed_outcome?: SettledWrite): Promise<SettledWrite> {
    if (!reply.ok && !(reply.error instanceof NativeHostError)) throw reply.error;
    const { path } = write;
    const writes = writes_of(path);
    if (reply.ok) writes_landed += 1;
    const unsynced = await read_unsynced();
    if (!unsynced || !Object.hasOwn(unsynced, path)) {
      // The refused file of the batch named what this one drops, and took it to the question.
      if (!reply.ok && write.drops === writes.drops && writes.end) return writes.end;
      // A swap replaced the browser copy during the write and dropped the path. On success the folder holds this text, and the copy is the swap's.
      return { kind: "replaced", by: writes.drop_causes[write.drops]!, written: reply.ok };
    }
    // A later pick started a new record after a swap: its own write goes next, from its own base.
    if (unsynced[path] !== write.base) return { kind: "superseded" };
    if (!reply.ok) {
      // The new record can share the dropped one's base, and this refusal and its folder read are older than it.
      if (write.drops !== writes.drops) return { kind: "superseded" };
      const error = reply.error as NativeHostError;
      // The rollback could not put this file back, so the folder holds the batch's text or an edit saved since. The record stays, and the next write's base check finds out which.
      if (error.refused_files.unrestored.includes(path)) return { kind: "failed", reason: error.message };
      if (changed_outcome) return changed_outcome.kind === "superseded" || changed_outcome.kind === "conflict" || changed_outcome.kind === "conflict_kept" ? { kind: "superseded" } : { kind: "failed", reason: error.message };
      if (error.failure === "file_changed") {
        // Both sides changed. The record stays for a retry when the folder cannot be read.
        if (!folder) return { kind: "failed", reason: `${path} changed on disk, and the config folder could not be read again` };
        // A replay of that read puts the other file back at its old text in the copy, so the write runs again and reads the folder anew.
        if (!folder.current) return { kind: "superseded" };
        if (writes.replays_in_a_row < MAX_REPLAYS_IN_A_ROW && (await replay_edits_onto_folder(path, unsynced, folder))) {
          writes.replays_in_a_row += 1;
          return { kind: "superseded" };
        }
        writes.replays_in_a_row = 0;
        // Only the user can choose. The path goes once the folder is classified, and the other paths keep their writes.
        const asked = await ask_when_folder_differs(folder, { clear_when_settled: false });
        const end: FileWriteOutcome = { kind: asked === "asked" ? "conflict" : "conflict_kept" };
        let kept = without_unsynced_path(unsynced, path);
        // A theme delete or an engine removal waits behind this write. The folder's settings.toml or keys file still names that theme or engine, so that file goes to the question too, and the folder keeps building.
        if (NAMING_PATHS.includes(path)) {
          const { files } = await load_files_source();
          for (const other of Object.keys(kept ?? {})) {
            if (!drops_what_is_named(other, path, folder.files[path] ?? null, files)) continue;
            kept = without_unsynced_path(kept, other);
            writes_of(other).end = end;
          }
        }
        await store_unsynced(kept);
        return (writes.end = end);
      }
      if (error.failure === "host_outdated") return { kind: "waiting", host_outdated: true };
      if (error.failure === "no_permission" || error.failure === "host_missing") return { kind: "waiting" };
      return { kind: "failed", reason: error.message };
    }
    const { files } = await load_files_source();
    const folder_now: UnsyncedFiles = { ...unsynced, [path]: write.text };
    // The folder now matches the copy wherever it matched before the edit, so a copy that held no other browser change still holds none, and the next start does not ask.
    if ((await files_digest(files_before_unsynced(files, unsynced))) === (await read_host_memory()).applied) await remember_applied(files_before_unsynced(files, folder_now));
    // A pick during the write is still ahead of the folder, and its write starts from this text.
    if ((files[path] ?? null) !== write.text) {
      await store_unsynced(folder_now);
      return { kind: "written" };
    }
    await store_unsynced(without_unsynced_path(unsynced, path));
    return (writes.end = { kind: "written" });
  }

  // After a refused write of settings.toml: swaps in the folder's files with the browser's edits set again on its new settings.toml, and moves the record to that text, so a hand edit saved during the write and the pick both stay.
  // Only for a copy that held no other browser change: the folder's files then replace it without losing one. False leaves everything as it was.
  // A whole file such as a theme has no keys to set again, so its refusal goes to the question.
  async function replay_edits_onto_folder(path: string, unsynced: UnsyncedFiles, folder: ConfigFilesReply): Promise<boolean> {
    if (path !== SETTINGS_FILE) return false;
    // The swap below is a setting write, which skips the checks of a folder read, so the folder's files pass them here: a `,r` of this folder would refuse it too.
    if (!folder.config_dir_exists || !has_config_files(folder.files) || css_limit_breaches(folder.files).length > 0) return false;
    const current = await load_files_source();
    if ((await files_digest(files_before_unsynced(current.files, unsynced))) !== (await read_host_memory()).applied) return false;
    // The other files of the record keep the copy's text and their own write. The folder must still hold each at its base, or at the copy's text when that write landed before the read: anything else is a hand edit for the question.
    const others = Object.keys(unsynced).filter((other) => other !== path);
    if (others.some((other) => (folder.files[other] ?? null) !== unsynced[other] && folder.files[other] !== current.files[other])) return false;
    const folder_text = folder.files[path] ?? null;
    const text = replayed_on_folder(unsynced[path] as string | null, current.files[path] ?? "", folder_text);
    if (text === undefined) return false;
    // The folder's other files too, as a start would adopt them: an edit saved to keymap.toml beside settings.toml applies now, not at some later reload.
    const files: ConfigFiles = { ...folder.files, [path]: text };
    for (const other of others) {
      const copy_text = current.files[other];
      if (copy_text === undefined) delete files[other];
      else files[other] = copy_text;
    }
    const replayed: UnsyncedFiles = { ...unsynced, [path]: folder_text };
    try {
      await apply_files({ files, dir_label: folder.config_dir, imported: false }, "setting", { edits_after: await load_edits(), unsynced: replayed });
    } catch (error) {
      if (error instanceof ConfigRefusal) return false;
      throw error;
    }
    // The copy now matches the folder outside the edits again, as after a folder read.
    await remember_applied(files_before_unsynced(files, replayed));
    return true;
  }

  // Stores the copies-differ question the settings page shows for `folder`, as a start would. `ignored` when the folder needs no question, for example a folder the user chose to keep the copy over.
  // `clear_when_settled` drops an older question that no longer applies. Runs in the change queue.
  async function ask_when_folder_differs(folder: ConfigFilesReply, { clear_when_settled }: { clear_when_settled: boolean }): Promise<"asked" | "ignored"> {
    const plan = await classify_host_start(folder, (await load_files_source()).files, await read_host_memory());
    if (plan.kind === "ask") {
      await store_host_pending(plan.pending);
      return "asked";
    }
    if (clear_when_settled) await clear_host_pending();
    return "ignored";
  }

  return { writes_of, note_record_dropped, mark_pick, already_in_queue, write_waiting_files, write_files, ask_when_folder_differs, read_folder_after_write, folder_build_problems, theme_resolves_without_file };
}

export type ConfigFileWrites = ReturnType<typeof create_config_file_writes>;
