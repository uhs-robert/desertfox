// Zip reader and writer for config export and import. Pure: no Node API, so the background and the help page can both use it. It reads untrusted archives, so every guard below fails the whole archive and none is skipped silently.

export interface ZipLimits {
  max_entry_bytes: number;
  max_total_bytes: number;
  max_entries: number;
}

// The byte caps match the host's reply cap (MAX_REPLY_BYTES).
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  max_entry_bytes: 1024 * 1024,
  max_total_bytes: 1024 * 1024,
  max_entries: 512,
};

// Deflate never grows data by more than 5 bytes per 16383-byte block plus a small header.
const DEFLATE_BLOCK_BYTES = 16383;
const INFLATE_SLICE_BYTES = 8192;
const MAX_PATH_BYTES = 255;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_LOCATOR_SIGNATURE = 0x07064b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const UNIX_HOST = 3;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
const DOS_DATE_1980_01_01 = 0x21;

const utf8_strict = new TextDecoder("utf-8", { fatal: true });
const utf8_encoder = new TextEncoder();

const crc_table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc_table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decode_utf8(bytes: Uint8Array, what: string): string {
  try {
    return utf8_strict.decode(bytes);
  } catch {
    throw new ZipError(`${what} is not valid UTF-8`);
  }
}

// A directory entry ("themes/") has no content and only passes the path rules. Returns the path without its trailing slash. A reader drops "." segments, because archivers such as bsdtar write "./a.toml" and a dot cannot leave the root. The writer refuses them.
function check_path(name: string, drop_dot_segments: boolean): string {
  if (name === "") throw new ZipError("an entry has an empty path");
  if (utf8_encoder.encode(name).length > MAX_PATH_BYTES) throw new ZipError(`path too long: ${name.slice(0, 40)}`);
  if (name.includes("\\")) throw new ZipError(`path has a backslash: ${name}`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ZipError(`path has a control character: ${JSON.stringify(name)}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new ZipError(`absolute path: ${name}`);
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  for (const segment of segments) {
    if (segment === "") throw new ZipError(`empty path segment: ${name}`);
    if (segment === "..") throw new ZipError(`path climbs out of the archive: ${name}`);
    if (segment === "." && !drop_dot_segments) throw new ZipError(`path has a dot segment: ${name}`);
  }
  return segments.filter((segment) => segment !== ".").join("/");
}

// Archivers add junk that the importer ignores anyway and that need not be text: Finder's __MACOSX/ AppleDouble files and dot-files such as .DS_Store. They are never inflated or decoded.
function is_ignored(path: string): boolean {
  return path === "" || path.split("/").some((segment) => segment === "__MACOSX" || segment.startsWith("."));
}

interface Entry {
  path: string;
  is_directory: boolean;
  ignored: boolean;
  method: number;
  crc: number;
  compressed_bytes: number;
  size: number;
  local_offset: number;
}

function find_end_record(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  for (let at = view.byteLength - END_RECORD_BYTES; at >= lowest; at--) {
    if (view.getUint32(at, true) !== END_SIGNATURE) continue;
    if (at + END_RECORD_BYTES + view.getUint16(at + 20, true) === view.byteLength) return at;
  }
  throw new ZipError("not a zip archive: no end record");
}

function read_central_directory(bytes: Uint8Array, limits: ZipLimits): { entries: Entry[]; directory_start: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = find_end_record(view);
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_END_LOCATOR_SIGNATURE) throw new ZipError("zip64 archives are not supported");
  const disk = view.getUint16(end + 4, true);
  const directory_disk = view.getUint16(end + 6, true);
  const on_this_disk = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const directory_bytes = view.getUint32(end + 12, true);
  const directory_start = view.getUint32(end + 16, true);
  if (disk !== 0 || directory_disk !== 0 || on_this_disk !== count) throw new ZipError("multi-disk archives are not supported");
  if (count === 0xffff || directory_bytes === 0xffffffff || directory_start === 0xffffffff) throw new ZipError("zip64 archives are not supported");
  if (count > limits.max_entries) throw new ZipError(`too many entries: ${count} (limit ${limits.max_entries})`);
  // The directory must end exactly where the end record starts, so nothing hides between them.
  if (directory_start + directory_bytes !== end) throw new ZipError("central directory does not fit the archive");

  const entries: Entry[] = [];
  let at = directory_start;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER_BYTES > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError("bad central directory entry");
    const made_by_host = view.getUint8(at + 5);
    const flags = view.getUint16(at + 8, true);
    const name_bytes = view.getUint16(at + 28, true);
    const extra_bytes = view.getUint16(at + 30, true);
    const comment_bytes = view.getUint16(at + 32, true);
    const external_attributes = view.getUint32(at + 38, true);
    const next = at + CENTRAL_HEADER_BYTES + name_bytes + extra_bytes + comment_bytes;
    if (next > end) throw new ZipError("bad central directory entry");
    const name = decode_utf8(bytes.subarray(at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + name_bytes), "an entry name");
    const raw_is_directory = name.endsWith("/");
    const path = check_path(name, true);
    if (flags & FLAG_ENCRYPTED) throw new ZipError(`encrypted entry: ${name}`);
    const method = view.getUint16(at + 10, true);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw new ZipError(`unsupported compression method ${method}: ${name}`);
    const unix_type = (external_attributes >>> 16) & UNIX_TYPE_MASK;
    if (made_by_host === UNIX_HOST && unix_type === UNIX_SYMLINK) throw new ZipError(`symlink entry: ${name}`);
    const compressed_bytes = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    if (compressed_bytes === 0xffffffff || size === 0xffffffff) throw new ZipError("zip64 archives are not supported");
    if (raw_is_directory && size !== 0) throw new ZipError(`directory entry with content: ${name}`);
    entries.push({
      path,
      is_directory: raw_is_directory,
      ignored: is_ignored(path),
      method,
      crc: view.getUint32(at + 16, true),
      compressed_bytes,
      size,
      local_offset: view.getUint32(at + 42, true),
    });
    at = next;
  }
  if (at !== end) throw new ZipError("central directory has trailing bytes");
  return { entries, directory_start };
}

function check_entries(entries: Entry[], limits: ZipLimits): void {
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (entry.ignored) continue;
    if (seen.has(entry.path)) throw new ZipError(`duplicate entry: ${entry.path}`);
    seen.add(entry.path);
    if (entry.size > limits.max_entry_bytes) throw new ZipError(`entry too large: ${entry.path} (limit ${limits.max_entry_bytes} bytes)`);
    total += entry.size;
    if (total > limits.max_total_bytes) throw new ZipError(`archive too large (limit ${limits.max_total_bytes} bytes)`);
    if (entry.method === METHOD_STORED && entry.compressed_bytes !== entry.size) throw new ZipError(`stored entry sizes differ: ${entry.path}`);
    const longest_deflate = entry.size + 5 * Math.ceil(entry.size / DEFLATE_BLOCK_BYTES) + 16;
    if (entry.method === METHOD_DEFLATE && entry.compressed_bytes > longest_deflate) throw new ZipError(`compressed size is not plausible: ${entry.path}`);
  }
}

// Returns each entry's data offset after checking that the local headers and data of different entries do not overlap and stay before the central directory.
function locate_data(bytes: Uint8Array, entries: Entry[], directory_start: number): Map<Entry, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data_starts = new Map<Entry, number>();
  const spans: { start: number; end: number; path: string }[] = [];
  for (const entry of entries) {
    const at = entry.local_offset;
    if (at + LOCAL_HEADER_BYTES > directory_start || view.getUint32(at, true) !== LOCAL_SIGNATURE) throw new ZipError(`bad local header: ${entry.path}`);
    const name_bytes = view.getUint16(at + 26, true);
    const extra_bytes = view.getUint16(at + 28, true);
    const data_start = at + LOCAL_HEADER_BYTES + name_bytes + extra_bytes;
    const data_end = data_start + entry.compressed_bytes;
    if (data_end > directory_start) throw new ZipError(`entry data runs past the archive: ${entry.path}`);
    const local_name = decode_utf8(bytes.subarray(at + LOCAL_HEADER_BYTES, at + LOCAL_HEADER_BYTES + name_bytes), "an entry name");
    if (check_path(local_name, true) !== entry.path) throw new ZipError(`local header name differs from the directory: ${entry.path}`);
    data_starts.set(entry, data_start);
    spans.push({ start: at, end: data_end, path: entry.path });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.start < spans[i - 1]!.end) throw new ZipError(`overlapping entries: ${spans[i - 1]!.path} and ${spans[i]!.path}`);
  }
  return data_starts;
}

// Stops at `size` bytes, so a header that understates the real length cannot make the stream run on. The input goes in small slices because a decompressor may inflate a whole chunk before the reader sees any of it.
async function inflate(compressed: Uint8Array, size: number, path: string): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  let filled = 0;
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const feed = (async () => {
    for (let at = 0; at < compressed.length; at += INFLATE_SLICE_BYTES) {
      await writer.write(compressed.subarray(at, at + INFLATE_SLICE_BYTES) as Uint8Array<ArrayBuffer>);
    }
    await writer.close();
  })();
  feed.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (filled + value.length > size) throw new ZipError(`entry is larger than its header says: ${path}`);
      out.set(value, filled);
      filled += value.length;
    }
    await feed;
  } catch (error) {
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    if (error instanceof ZipError) throw error;
    throw new ZipError(`entry does not decompress: ${path}`);
  }
  if (filled !== size) throw new ZipError(`entry is smaller than its header says: ${path}`);
  return out;
}

// Reads every file entry as UTF-8 text, keyed by its path. Any guard failure throws a ZipError and returns nothing.
export async function read_zip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<Map<string, string>> {
  const { entries, directory_start } = read_central_directory(bytes, limits);
  const data_starts = locate_data(bytes, entries, directory_start);
  check_entries(entries, limits);
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (entry.is_directory || entry.ignored) continue;
    const start = data_starts.get(entry)!;
    const stored = bytes.subarray(start, start + entry.compressed_bytes);
    const data = entry.method === METHOD_STORED ? stored : await inflate(stored, entry.size, entry.path);
    if (crc32(data) !== entry.crc) throw new ZipError(`checksum mismatch: ${entry.path}`);
    files.set(entry.path, decode_utf8(data, entry.path));
  }
  return files;
}

// Store-only: config text is small, and a stored archive needs no compressor. The output is deterministic (fixed timestamp, insertion order).
export function write_zip(files: Map<string, string> | Record<string, string>, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Uint8Array {
  const pairs = files instanceof Map ? [...files] : Object.entries(files);
  if (pairs.length > limits.max_entries) throw new ZipError(`too many entries: ${pairs.length} (limit ${limits.max_entries})`);
  const seen = new Set<string>();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  for (const [name, text] of pairs) {
    if (name.endsWith("/")) throw new ZipError(`not a file path: ${name}`);
    check_path(name, false);
    if (seen.has(name)) throw new ZipError(`duplicate entry: ${name}`);
    seen.add(name);
    const name_bytes = utf8_encoder.encode(name);
    const data = utf8_encoder.encode(text);
    if (data.length > limits.max_entry_bytes) throw new ZipError(`entry too large: ${name} (limit ${limits.max_entry_bytes} bytes)`);
    total += data.length;
    if (total > limits.max_total_bytes) throw new ZipError(`archive too large (limit ${limits.max_total_bytes} bytes)`);
    const crc = crc32(data);

    const local = new Uint8Array(LOCAL_HEADER_BYTES + name_bytes.length + data.length);
    const local_view = new DataView(local.buffer);
    local_view.setUint32(0, LOCAL_SIGNATURE, true);
    local_view.setUint16(4, 20, true);
    local_view.setUint16(6, FLAG_UTF8, true);
    local_view.setUint16(10, 0, true);
    local_view.setUint16(12, DOS_DATE_1980_01_01, true);
    local_view.setUint32(14, crc, true);
    local_view.setUint32(18, data.length, true);
    local_view.setUint32(22, data.length, true);
    local_view.setUint16(26, name_bytes.length, true);
    local.set(name_bytes, LOCAL_HEADER_BYTES);
    local.set(data, LOCAL_HEADER_BYTES + name_bytes.length);

    const central = new Uint8Array(CENTRAL_HEADER_BYTES + name_bytes.length);
    const central_view = new DataView(central.buffer);
    central_view.setUint32(0, CENTRAL_SIGNATURE, true);
    central_view.setUint16(4, (UNIX_HOST << 8) | 20, true);
    central_view.setUint16(6, 20, true);
    central_view.setUint16(8, FLAG_UTF8, true);
    central_view.setUint16(12, 0, true);
    central_view.setUint16(14, DOS_DATE_1980_01_01, true);
    central_view.setUint32(16, crc, true);
    central_view.setUint32(20, data.length, true);
    central_view.setUint32(24, data.length, true);
    central_view.setUint16(28, name_bytes.length, true);
    central_view.setUint32(38, (0o100644 << 16) >>> 0, true);
    central_view.setUint32(42, offset, true);
    central.set(name_bytes, CENTRAL_HEADER_BYTES);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory_bytes = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(END_RECORD_BYTES);
  const end_view = new DataView(end.buffer);
  end_view.setUint32(0, END_SIGNATURE, true);
  end_view.setUint16(8, pairs.length, true);
  end_view.setUint16(10, pairs.length, true);
  end_view.setUint32(12, directory_bytes, true);
  end_view.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directory_bytes + END_RECORD_BYTES);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
