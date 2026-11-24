import { stringify } from "smol-toml";
import { warn_and_go } from "../shared/swallow.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import { parse_toml_text, type ConfigFiles } from "../shared/config_build/source_files.ts";
import { load_edits, load_files_source } from "../shared/config/config_load.ts";
import { engine_file_text, engine_resolves_without_owned, engines_in_text, ENGINE_FILE, holds_engine, owned_engines } from "./engine_file.ts";
import { KEYS_FILE, letters_in_text } from "./engine_keys_file.ts";
import { host_file_of, NativeHostError } from "./native_client.ts";
import type { ConfigFilesReply } from "./native_client.ts";
import { build_files_config, ConfigRefusal } from "./config_reload.ts";
import { css_limit_breaches } from "./css_limits.ts";
import { classify_host_start, clear_host_pending, files_digest, has_config_files, read_host_memory, remember_applied, store_host_pending } from "./host_start.ts";
import { files_before_unsynced, read_unsynced, replayed_on_folder, SETTINGS_FILE, store_unsynced, theme_named_in, default_engine_named_in, text_sha256, without_unsynced_path } from "./settings_file.ts";
import type { CopyReplacedBy, FileWriteOutcome, UnsyncedFiles } from "./settings_file.ts";
import { theme_file_path } from "./theme_message.ts";
import type { ConfigStore } from "./config_store.ts";
import type { ConfigSwap } from "./config_swap.ts";
import type { Services } from "./services.ts";

type HostWriteReply = { ok: true } | { ok: false; error: unknown };

// `superseded`: the record moved to a newer base during the write, so the write loop goes on from it.
type SettledWrite = FileWriteOutcome | { kind: "superseded" };

// A write of the file at `path` sent to the host (`text` null deletes it). The change queue starts it and settles its reply once, and the host call runs between the two, outside the queue.
// `covers` and `drops` are the path's `picks_made` and `drops` at the start: the text holds every pick of the path up to `covers` made since that many drops.
type HostWrite = { path: string; base: string | null; text: string | null; covers: number; drops: number; reply: Promise<HostWriteReply>; outcome?: Promise<SettledWrite> };

// What the write loop keeps for one path of the record. Each path has its own, so a refusal, a drop or a write out on one file never decides another file's outcome.
// It lives in memory only, as the replies that read it do.
// A pick is numbered when it stores the record, and a swap that drops the path counts as a drop, so a pick can tell a write that holds it from one that does not.
type PathWrites = {
  // The write out now. One at a time per path: a second write against the same base would find the first one's text and be refused.
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

// Runs `start` and `settle` in the change queue, or inline for a caller already in it.
export type QueueRunner = <T>(work: () => Promise<T>) => Promise<T>;

// The folder as the host reads it now, for the gate of a write of `path`, with the count of writes landed before the read. Undefined when nothing waits for it.
// A failed read holds the write, since nothing checked it. A host that is missing or not permitted waits instead, as the write itself would.
// `reused`: an earlier gate of the batch read it, so it can miss a hand edit saved since.
type GateFolder = ConfigFilesReply & { landed: number; reused?: true };

// One gate read that the writes of a batch share: an import's, or the waiting files' at a start or `,r`. Each write the batch lands moves it on, so a batch of 40 files reads the folder once.
// Empty until the first gate. A write that lands from outside the batch makes it stale, and the next gate reads the folder again.
type GateBatch = { read?: GateFolder };

// The folder read after a refusal. `current` is false when another path's write settled since the read began, so the read can hold that file's text from before the write.
type FolderAfterRefusal = ConfigFilesReply & { current: boolean };

// The host write pipeline: the record of each path's writes, the write loops, the gate and the replay of a refused write.
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
  // Successful writes settled so far, of any path. A folder read taken before another path's write settled can hold that file's old text.
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

  // Writes every file the folder lags, one path after the other. A path that ends refused or waiting leaves the next one to its own write.
  async function write_waiting_files(in_queue: QueueRunner): Promise<void> {
    const unsynced = await in_queue(read_unsynced);
    await write_files_in_order(in_queue, Object.keys(unsynced ?? {}).map((path) => ({ path })));
  }

  // Writes a batch of waiting files in `order_of_writes`, with one gate read for all of them, and gives each path's outcome (that of its pick, when it has one).
  // The order is a guess, so a path the gate holds goes again after a round in which another file landed: what it names can land after it.
  // A round where every path left is held is a cycle, such as a default engine switch whose file also drops the old engine. A held definitions file then gets one bridge write (`definitions_bridge_text`).
  async function write_files_in_order(in_queue: QueueRunner, items: { path: string; pick?: PickMark }[]): Promise<Map<string, FileWriteOutcome | undefined>> {
    const batch: GateBatch = {};
    const outcomes = new Map<string, FileWriteOutcome | undefined>();
    const bridged = new Set<string>();
    let round = order_of_writes(items);
    while (round.length > 0) {
      const held: typeof round = [];
      let landed = false;
      for (const item of round) {
        const outcome = await write_waiting_file(in_queue, item.path, item.pick, [], batch);
        outcomes.set(item.path, outcome);
        if (outcome?.kind === "held" && !outcome.unread) held.push(item);
        else if (outcome?.kind === "written") landed = true;
      }
      for (const item of landed ? [] : held.filter(({ path }) => !bridged.has(path))) {
        bridged.add(item.path);
        const bridge = await write_bridge(in_queue, item.path, definitions_bridge_text, batch);
        landed ||= bridge?.kind === "written" || bridge?.kind === "superseded";
      }
      round = landed ? held : [];
    }
    return outcomes;
  }

  // Definitions first (themes, engines, aliases, quickmarks, CSS), then key files (the page's key letters too), then settings files: a file mostly names what a file of an earlier rank defines.
  function write_rank(path: string): number {
    if (path === SETTINGS_FILE || path.startsWith("settings.d/")) return 2;
    if (path === "keymap.toml" || path.startsWith("keymap.d/")) return 1;
    return 0;
  }
  const order_of_writes = <T extends { path: string }>(items: T[]): T[] => [...items].sort((left, right) => write_rank(left.path) - write_rank(right.path));

  // The files whose top-level tables or keys are each one definition, an engine or an alias, so the union of two texts keeps both sets.
  const DEFINITIONS_FILE = /^(search_engines|command_aliases)(\.toml$|\.d\/)/;

  // A bridge for a definitions file held in a cycle: the folder's definitions (the record's base) with the copy's over them. It drops nothing a folder file names and holds what the copy's files name, so they can land, then the file as the copy has it.
  // Undefined for another file, a text that does not parse, or a copy that drops nothing. The page's file has its own bridge (`page_engines_bridge_text`).
  function definitions_bridge_text(path: string, base: string | null, files: ConfigFiles): string | undefined {
    const copy = files[path];
    if (!DEFINITIONS_FILE.test(path) || path === ENGINE_FILE || base === null || copy === undefined) return undefined;
    const folder_tables = parse_toml_text(path, base, []);
    const copy_tables = parse_toml_text(path, copy, []);
    if (!folder_tables || !copy_tables || Object.keys(folder_tables).every((name) => Object.hasOwn(copy_tables, name))) return undefined;
    return stringify({ ...folder_tables, ...copy_tables });
  }

  // The folder's engines in the page's file (the record's base) with the copy's over them.
  const page_engines_bridge_text = (_path: string, base: string | null, files: ConfigFiles): string => engine_file_text({ ...engines_in_text(base), ...owned_engines(files) });

  // Writes the browser copy of the file at `path` to the folder while the folder lags it, and again for a pick made during a write. Undefined when nothing waited.
  // With `pick` it stops at the outcome of that pick: the write that holds it, or the swap that replaced it.
  // `waiting_above` holds the paths of the outer loops that wait for this one to land first.
  async function write_waiting_file(in_queue: QueueRunner, path: string, pick?: PickMark, waiting_above: string[] = [], batch: GateBatch = {}): Promise<FileWriteOutcome | undefined> {
    const writes = writes_of(path);
    let outcome: FileWriteOutcome | undefined;
    writes.replays_in_a_row = 0;
    // Whether a write that held the pick reached the folder before a swap replaced the copy.
    let pick_written = false;
    const replaced = (): FileWriteOutcome | undefined => (pick && writes.drops !== pick.drops ? { kind: "replaced", by: writes.drop_causes[pick.drops]!, written: pick_written } : undefined);
    const holds_pick = (write: HostWrite) => pick !== undefined && write.covers >= pick.seq && write.drops === pick.drops;
    // Each path that must land first gets one write from this loop, a theme file and the page's file each. A path still behind after that waits for a later loop, so two files never chase each other.
    let first_outcome: FileWriteOutcome | undefined;
    const written_first = new Set<string>();
    let bridges = 0;
    for (;;) {
      const first = await in_queue(() => path_to_write_first(path));
      // Each waits for the other: settings.toml or the keys file names an engine only the copy's page file has, and that file drops an engine the folder's settings.toml or keys file names.
      // The bridge file holds both, so the namer can land, then the page file as the copy has it.
      if (first !== undefined && waiting_above.includes(first)) {
        if (bridges === MAX_BRIDGES) return replaced() ?? { kind: "waiting" };
        bridges += 1;
        const bridged = (await write_bridge(in_queue, ENGINE_FILE, page_engines_bridge_text, batch)) ?? { kind: "written" };
        if (bridged.kind !== "written" && bridged.kind !== "superseded") return replaced() ?? bridged;
        if (path === ENGINE_FILE) await write_waiting_file(in_queue, first, undefined, [...waiting_above, path], batch);
        continue;
      }
      if (first !== undefined) {
        if (written_first.has(first)) return replaced() ?? (first_outcome && first_outcome.kind !== "written" ? first_outcome : { kind: "waiting" });
        written_first.add(first);
        first_outcome = await write_waiting_file(in_queue, first, undefined, [...waiting_above, path], batch);
        continue;
      }
      const gate_read = await folder_for_gate(in_queue, path, batch);
      if (gate_read !== undefined && !is_gate_folder(gate_read)) return replaced() ?? gate_read;
      const folder_now = gate_read;
      const started = await in_queue(async () => replaced() ?? (is_stale(folder_now) ? "stale" : await start_host_write(path, undefined, folder_now)));
      if (started === "stale") continue;
      if (started === undefined) return outcome ?? (pick && writes.end);
      if ("kind" in started) {
        // A hand edit since the batch's read can make the folder build with this file, so a held write checks again on a read of its own.
        if (started.kind === "held" && folder_now?.reused) {
          delete batch.read;
          continue;
        }
        // A write of another file that is out can make the folder build again once it lands, so this path tries again after it.
        // It settles those writes itself rather than wait for their owners: under `,r` this loop holds the change queue, and an owner settles only in a later turn of it.
        // One at a time: under `,r` each settle runs inline, and two at once each store the record without the other's path removed.
        const others_out = started.kind === "held" ? writes_out_besides(path) : [];
        if (others_out.length === 0) return started;
        for (const write of others_out) await settle_out_write(in_queue, write);
        continue;
      }
      const settled = await settle_out_write(in_queue, started, (shared, reply) => {
        if (reply.ok && holds_pick(started)) pick_written = true;
        return replaced() ?? shared;
      });
      move_batch_on(batch, started, settled);
      if (settled.kind === "superseded") continue;
      outcome = settled;
      if (outcome.kind !== "written" || (pick && started.covers >= pick.seq)) return outcome;
    }
  }

  // A settings.toml `theme` or `default_engine`, or a page key letter, and the file that holds what it names reach the folder in the order that keeps the folder building: the file before a namer that names it, and a namer that names it no more before the file that drops it.
  // The path of the record whose write goes before the one at `path`, or undefined. In the change queue.
  async function path_to_write_first(path: string): Promise<string | undefined> {
    const unsynced = await read_unsynced();
    if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
    const { files } = await load_files_source();
    if (path === SETTINGS_FILE) return files_named_by_settings(files[SETTINGS_FILE] ?? null, files, unsynced).find((named_path) => Object.hasOwn(unsynced, named_path));
    if (path === KEYS_FILE) return Object.hasOwn(unsynced, ENGINE_FILE) && keys_name_new_engine(files, unsynced) ? ENGINE_FILE : undefined;
    // The folder holds the base, or soon the text of a namer's write that is out, so neither may name what `path` drops.
    return NAMING_PATHS.find((namer) => {
      if (!Object.hasOwn(unsynced, namer)) return false;
      const out = writes_of(namer).out;
      return [unsynced[namer] ?? null, ...(out ? [out.text] : [])].some((text) => drops_what_is_named(path, namer, text, files));
    });
  }

  // The files that name what another file holds: settings.toml a theme or an engine, the page's keys file an engine.
  const NAMING_PATHS = [SETTINGS_FILE, KEYS_FILE];

  // Whether the copy's keys file binds a letter to an engine of the copy's page file that the folder's page file (the record's base) lacks.
  function keys_name_new_engine(files: ConfigFiles, unsynced: UnsyncedFiles): boolean {
    const folder_engines = engines_in_text(unsynced[ENGINE_FILE] ?? null);
    return Object.values(letters_in_text(files[KEYS_FILE] ?? null)).some((engine) => holds_engine(owned_engines(files), engine) && !holds_engine(folder_engines, engine));
  }

  // Whether the copy's file at `path` drops what the file `namer`, at `text`, names.
  function drops_what_is_named(path: string, namer: string, text: string | null, files: ConfigFiles): boolean {
    if (namer === SETTINGS_FILE) return drops_what_settings_names(path, text, files);
    return path === ENGINE_FILE && Object.values(letters_in_text(text)).some((engine) => !holds_engine(owned_engines(files), engine) && !engine_resolves_without_owned(files, engine));
  }

  // The files of the copy that hold what a settings.toml of `text` names and the folder lacks: the theme file of its `theme`, and the Engines page's file when it defines the `default_engine` and the folder's page file (the record's base) does not.
  function files_named_by_settings(text: string | null, files: ConfigFiles, unsynced: UnsyncedFiles): string[] {
    const theme = theme_named_in(text);
    const engine = default_engine_named_in(text);
    const theme_path = theme === undefined ? undefined : theme_file_path(theme);
    const engine_file_needed = engine !== undefined && holds_engine(owned_engines(files), engine) && !holds_engine(engines_in_text(unsynced[ENGINE_FILE] ?? null), engine);
    return [...(theme_path !== undefined && files[theme_path] !== undefined ? [theme_path] : []), ...(engine_file_needed ? [ENGINE_FILE] : [])];
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

  // The writes of a bridge file one write loop makes before it gives up and waits.
  const MAX_BRIDGES = 3;

  // Writes the bridge text `bridge_text_of` gives the file at `path`, from the record's base and the copy's files. Undefined when the record no longer holds the path or the file has no bridge.
  // The record keeps the file at the bridge text as its base, so the copy's own text follows.
  async function write_bridge(in_queue: QueueRunner, path: string, bridge_text_of: (path: string, base: string | null, files: ConfigFiles) => string | undefined, batch: GateBatch): Promise<SettledWrite | undefined> {
    const gate_read = await folder_for_gate(in_queue, path, batch);
    if (gate_read !== undefined && !is_gate_folder(gate_read)) return gate_read;
    const folder_now = gate_read;
    const started = await in_queue(async () => {
      const unsynced = await read_unsynced();
      if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
      if (is_stale(folder_now)) return { kind: "superseded" } as const;
      const bridge = bridge_text_of(path, unsynced[path] ?? null, (await load_files_source()).files);
      return bridge === undefined ? undefined : start_host_write(path, bridge, folder_now);
    });
    if (started === undefined || "kind" in started) return started;
    const settled = await settle_out_write(in_queue, started);
    move_batch_on(batch, started, settled);
    return settled;
  }

  // A write of the batch landed. When it is the only write that landed since the batch's read, the read takes its text, and the next gate needs no read of its own.
  function move_batch_on(batch: GateBatch, write: HostWrite, settled: SettledWrite): void {
    const read = batch.read;
    if (settled.kind !== "written" || !read || read.landed + 1 !== writes_landed) return;
    batch.read = { ...read, files: with_file_text(read.files, write.path, write.text), landed: writes_landed };
  }

  // Waits for the host's reply to `write`, reads the folder after a refusal, then settles the write in the change queue. `in_turn` runs in that same turn.
  // Any caller can settle a write, not just the loop that started it: `settle_host_write` applies the reply once and hands every caller the same outcome.
  async function settle_out_write(in_queue: QueueRunner, write: HostWrite, in_turn = (shared: SettledWrite, _reply: HostWriteReply) => shared): Promise<SettledWrite> {
    const reply = await write.reply;
    const landed_before_read = writes_landed;
    const folder = changed_on_disk(reply) ? await read_folder_after_write() : undefined;
    return in_queue(async () => in_turn(await settle_host_write(write, reply, folder && { ...folder, current: writes_landed === landed_before_read }), reply));
  }

  // Every write must leave the folder building: a file can name or drop an engine, a theme, an alias, a keyword or a letter another depends on.
  // The batch's read stands in for a new one while no write from outside it landed.
  async function folder_for_gate(in_queue: QueueRunner, path: string, batch: GateBatch): Promise<GateFolder | FileWriteOutcome | undefined> {
    const unsynced = await in_queue(read_unsynced);
    if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
    if (batch.read && !is_stale(batch.read)) return { ...batch.read, reused: true };
    const landed = writes_landed;
    try {
      return (batch.read = { ...(await native_host.read_config()), landed });
    } catch (error) {
      if (error instanceof NativeHostError && (error.failure === "no_permission" || error.failure === "host_missing")) return { kind: "waiting" };
      return { kind: "held", problem: error instanceof Error ? error.message : String(error), unread: true };
    }
  }

  // A write landed since the gate's read, so the read can hold that file's old text. The loop reads the folder again.
  const is_stale = (folder: GateFolder | undefined): boolean => folder !== undefined && folder.landed !== writes_landed;
  const is_gate_folder = (read: GateFolder | FileWriteOutcome | undefined): read is GateFolder => read !== undefined && "files" in read;

  const writes_out_besides = (path: string): HostWrite[] => [...path_writes.entries()].flatMap(([other, writes]) => (other !== path && writes.out ? [writes.out] : []));

  const with_file_text = (files: ConfigFiles, path: string, text: string | null): ConfigFiles => {
    const { [path]: _old, ...others } = files;
    return text === null ? others : { ...others, [path]: text };
  };

  function folder_build_problems(files: ConfigFiles, dir_label: string): string[] {
    try {
      build_files_config(files, dir_label, built_in_commands(), "setting");
      return [];
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      return error.problems.length > 0 ? error.problems : [error.message];
    }
  }

  // The gate of a write: the folder after it, as far as the extension knows (the folder's files, every write still out, then `text`), must build with no problem the folder without it lacks.
  // The first new problem, or undefined. One check covers every way a write can break the folder: a default engine or child it drops, a keyword it doubles, a settings.d file that names what it removes.
  function write_breaks_folder(path: string, text: string | null, folder: ConfigFilesReply): string | undefined {
    const before = writes_out_besides(path).reduce((files, write) => with_file_text(files, write.path, write.text), folder.files);
    const known = new Set(folder_build_problems(before, folder.config_dir));
    return folder_build_problems(with_file_text(before, path, text), folder.config_dir).find((problem) => !known.has(problem));
  }

  // In the change queue. Sends the browser copy of the file at `path` when the folder lags it, or hands back the write already out.
  // A file the copy no longer has is deleted from the folder, through the same base check. `bridge_text` replaces the copy's text, and such a write holds no pick.
  // With `folder`, a write that breaks the folder build stays in the record and answers `held` (`write_breaks_folder`).
  async function start_host_write(path: string, bridge_text?: string, folder?: GateFolder): Promise<HostWrite | FileWriteOutcome | undefined> {
    const writes = writes_of(path);
    if (writes.out) return writes.out;
    const unsynced = await read_unsynced();
    if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
    const base = unsynced[path] as string | null;
    const text = bridge_text ?? (await load_files_source()).files[path] ?? null;
    if (text === null && base === null) {
      // Neither side has the file, so there is nothing to write.
      await store_unsynced(without_unsynced_path(unsynced, path));
      return (writes.end = { kind: "written" });
    }
    const problem = folder && write_breaks_folder(path, text, folder);
    if (problem !== undefined) return { kind: "held", problem };
    const base_sha256 = base === null ? null : await text_sha256(base);
    const reply = native_host.write_config_file(path, text, base_sha256).then((): HostWriteReply => ({ ok: true }), (error: unknown): HostWriteReply => ({ ok: false, error }));
    writes.out = { path, base, text, covers: bridge_text === undefined ? writes.picks_made : -1, drops: writes.drops, reply };
    return writes.out;
  }

  const theme_name_of_file = (path: string): string | undefined => {
    const file = host_file_of(path);
    return file?.kind === "theme" ? file.name : undefined;
  };

  const changed_on_disk = (reply: HostWriteReply) => !reply.ok && reply.error instanceof NativeHostError && reply.error.failure === "file_changed";

  const read_folder_after_write = () => native_host.read_config().catch(warn_and_go("read the folder after a config file write"));

  // In the change queue. Applies the host's reply to the record once, however many callers waited on the write. `folder` is undefined when it could not be read.
  function settle_host_write(write: HostWrite, reply: HostWriteReply, folder: FolderAfterRefusal | undefined): Promise<SettledWrite> {
    const writes = writes_of(write.path);
    if (writes.out === write) delete writes.out;
    // Only the first settle resets the count: a later one can run while a newer write loop of the path replays.
    if (!write.outcome) {
      if (reply.ok) writes.replays_in_a_row = 0;
      write.outcome = outcome_of_host_write(write, reply, folder);
    }
    return write.outcome;
  }

  async function outcome_of_host_write(write: HostWrite, reply: HostWriteReply, folder: FolderAfterRefusal | undefined): Promise<SettledWrite> {
    if (!reply.ok && !(reply.error instanceof NativeHostError)) throw reply.error;
    const { path } = write;
    const writes = writes_of(path);
    const unsynced = await read_unsynced();
    // A swap replaced the browser copy during the write and dropped the path. On success the folder holds this text, and the copy is the swap's.
    if (!unsynced || !Object.hasOwn(unsynced, path)) return { kind: "replaced", by: writes.drop_causes[write.drops]!, written: reply.ok };
    // A later pick started a new record after a swap: its own write goes next, from its own base.
    if (unsynced[path] !== write.base) return { kind: "superseded" };
    if (!reply.ok) {
      // The new record can share the dropped one's base, and this refusal and its folder read are older than it.
      if (write.drops !== writes.drops) return { kind: "superseded" };
      const error = reply.error as NativeHostError;
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
    writes_landed += 1;
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

  return { writes_of, note_record_dropped, mark_pick, already_in_queue, write_waiting_files, write_files_in_order, write_waiting_file, ask_when_folder_differs, read_folder_after_write, folder_build_problems, theme_resolves_without_file };
}

export type ConfigFileWrites = ReturnType<typeof create_config_file_writes>;
