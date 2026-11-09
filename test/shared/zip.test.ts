import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { DEFAULT_ZIP_LIMITS, ZipError, read_zip, write_zip } from "../../src/shared/zip.ts";

interface Crafted {
  name: string;
  data?: Uint8Array;
  deflate?: boolean;
  // Overrides for lying headers.
  declared_size?: number;
  declared_compressed?: number;
  crc?: number;
  local_name?: string;
  local_offset?: number;
  flags?: number;
  method?: number;
  external_attributes?: number;
  made_by_host?: number;
  // Like Info-ZIP and bsdtar when streaming: flag bit 3, zero sizes in the local header, a data descriptor after the data.
  descriptor?: boolean;
  local_extra?: Uint8Array;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A hand-built archive, so a test can break any single header field the real writer would never break.
function craft(entries: Crafted[], tail: { comment?: Uint8Array } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = entry.data ?? new Uint8Array();
    const body = entry.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = encoder.encode(entry.name);
    const local_name = encoder.encode(entry.local_name ?? entry.name);
    const method = entry.method ?? (entry.deflate ? 8 : 0);
    const crc = entry.crc ?? crc32(raw);
    const size = entry.declared_size ?? raw.length;
    const compressed = entry.declared_compressed ?? body.length;

    const extra = entry.local_extra ?? new Uint8Array();
    const descriptor_bytes = entry.descriptor ? 16 : 0;
    const local = new Uint8Array(30 + local_name.length + extra.length + body.length + descriptor_bytes);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, (entry.flags ?? 0x800) | (entry.descriptor ? 0x8 : 0), true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, entry.descriptor ? 0 : crc, true);
    lv.setUint32(18, entry.descriptor ? 0 : compressed, true);
    lv.setUint32(22, entry.descriptor ? 0 : size, true);
    lv.setUint16(26, local_name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(local_name, 30);
    local.set(extra, 30 + local_name.length);
    local.set(body, 30 + local_name.length + extra.length);
    if (entry.descriptor) {
      const at = 30 + local_name.length + extra.length + body.length;
      lv.setUint32(at, 0x08074b50, true);
      lv.setUint32(at + 4, crc, true);
      lv.setUint32(at + 8, compressed, true);
      lv.setUint32(at + 12, size, true);
    }

    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint8(5, entry.made_by_host ?? 3);
    cv.setUint16(4, ((entry.made_by_host ?? 3) << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, entry.flags ?? 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, entry.external_attributes ?? 0, true);
    cv.setUint32(42, entry.local_offset ?? offset, true);
    c.set(name, 46);
    parts.push(local);
    central.push(c);
    offset += local.length;
  }
  const directory = central.reduce((sum, p) => sum + p.length, 0);
  const comment = tail.comment ?? new Uint8Array();
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  const out = new Uint8Array(offset + directory + end.length);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const text = (s: string) => encoder.encode(s);

async function rejects(bytes: Uint8Array, pattern: RegExp): Promise<void> {
  await assert.rejects(read_zip(bytes), (error: unknown) => error instanceof ZipError && pattern.test(error.message));
}

test("write then read round-trips paths and text, including non-ASCII", async () => {
  const files = { "settings.toml": "a = 1\n", "snippets/x.js": "// caf\u00e9\n", "style.d/10.css": "" };
  assert.deepEqual(Object.fromEntries(await read_zip(write_zip(files))), files);
});

test("write_zip is deterministic and accepts a Map", () => {
  const a = write_zip({ "a.toml": "x", "b.toml": "y" });
  const b = write_zip(new Map([["a.toml", "x"], ["b.toml", "y"]]));
  assert.deepEqual(a, b);
});

test("an empty archive reads as no files", async () => {
  assert.equal((await read_zip(write_zip({}))).size, 0);
});

test("reads a deflated entry and skips directory entries", async () => {
  const body = text("key = 'value'\n".repeat(50));
  const bytes = craft([{ name: "themes/" }, { name: "themes/a.toml", data: body, deflate: true }]);
  assert.deepEqual([...(await read_zip(bytes))], [["themes/a.toml", new TextDecoder().decode(body)]]);
});

test("reads an archive that has a trailing comment", async () => {
  const bytes = craft([{ name: "a.toml", data: text("x") }], { comment: text("made by zip") });
  assert.equal((await read_zip(bytes)).get("a.toml"), "x");
});

test("rejects bytes that are not a zip", async () => {
  await rejects(text("just some text, not an archive at all"), /no end record/);
  await rejects(new Uint8Array(), /no end record/);
});

for (const [label, name, pattern] of [
  ["zip slip with ..", "../evil.toml", /climbs out/],
  ["zip slip in the middle", "themes/../../evil.toml", /climbs out/],
  ["absolute path", "/etc/passwd", /absolute/],
  ["drive letter", "C:/evil.toml", /absolute/],
  ["backslash", "themes\\a.toml", /backslash/],
  ["backslash climb", "..\\evil.toml", /backslash/],
  ["empty segment", "a//b.toml", /empty path segment/],
  ["control character", "a\u0000b.toml", /control/],
  ["empty name", "", /empty path/],
] as const) {
  test(`rejects ${label}`, async () => {
    await rejects(craft([{ name, data: text("x") }]), pattern);
    assert.throws(() => write_zip({ [name]: "x" }), ZipError);
  });
}

test("rejects a name that is not UTF-8", async () => {
  const bytes = craft([{ name: "abc.toml", data: text("x") }]);
  const at = bytes.indexOf(0x61, bytes.length - 22 - 8 - 46);
  bytes[at] = 0xff;
  await rejects(bytes, /not valid UTF-8/);
});

test("rejects exact duplicate entries, also after dot segments are dropped", async () => {
  await rejects(craft([{ name: "a.toml", data: text("1") }, { name: "a.toml", data: text("2") }]), /duplicate/);
  await rejects(craft([{ name: "a.toml", data: text("1") }, { name: "./a.toml", data: text("2") }]), /duplicate/);
});

test("names that differ only in case are two files", async () => {
  const files = { "themes/Dark.toml": "1", "themes/dark.toml": "2" };
  assert.deepEqual(Object.fromEntries(await read_zip(write_zip(files))), files);
});

test("the writer refuses a dot segment, the reader drops it", async () => {
  assert.throws(() => write_zip({ "./a.toml": "x" }), /dot segment/);
  const bytes = craft([{ name: "./" }, { name: "./themes/" }, { name: "./themes/a.toml", data: text("x") }]);
  assert.deepEqual([...(await read_zip(bytes))], [["themes/a.toml", "x"]]);
});

test("reads a bsdtar-style archive: ./ names and data descriptors", async () => {
  const body = text("key = 'value'\n".repeat(40));
  const bytes = craft([
    { name: "./", descriptor: true },
    { name: "./settings.toml", data: text("a = 1\n"), descriptor: true },
    { name: "./style.css", data: body, deflate: true, descriptor: true },
  ]);
  const files = await read_zip(bytes);
  assert.deepEqual([...files.keys()], ["settings.toml", "style.css"]);
  assert.equal(files.get("style.css"), new TextDecoder().decode(body));
});

test("reads an entry whose local extra field differs from the central one", async () => {
  const bytes = craft([{ name: "a.toml", data: text("x"), local_extra: new Uint8Array([0x55, 0x54, 0x01, 0x00, 0x03]) }]);
  assert.equal((await read_zip(bytes)).get("a.toml"), "x");
});

test("skips Finder junk without decoding it, and still reads the config", async () => {
  const apple_double = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0xb0, 0xff, 0xfe, 0x80]);
  const bytes = craft([
    { name: "cfg/" },
    { name: "cfg/settings.toml", data: text("a = 1\n") },
    { name: "cfg/.DS_Store", data: apple_double },
    { name: "__MACOSX/" },
    { name: "__MACOSX/cfg/", },
    { name: "__MACOSX/cfg/._settings.toml", data: apple_double, deflate: true },
  ]);
  assert.deepEqual([...(await read_zip(bytes))], [["cfg/settings.toml", "a = 1\n"]]);
});

test("junk entries still pass the path rules", async () => {
  await rejects(craft([{ name: "__MACOSX/../evil", data: text("x") }]), /climbs out/);
});

test("rejects a symlink entry", async () => {
  const link = (0o120777 << 16) >>> 0;
  await rejects(craft([{ name: "link.toml", data: text("/etc/passwd"), external_attributes: link }]), /symlink/);
  // A DOS-made entry has no Unix mode, so the same bits there mean nothing.
  assert.equal((await read_zip(craft([{ name: "a.toml", data: text("x"), external_attributes: link, made_by_host: 0 }]))).size, 1);
});

test("rejects an encrypted entry and an unknown method", async () => {
  await rejects(craft([{ name: "a.toml", data: text("x"), flags: 0x801 }]), /encrypted/);
  await rejects(craft([{ name: "a.toml", data: text("x"), method: 12 }]), /unsupported compression/);
});

test("rejects non-UTF-8 file text, stored or deflated", async () => {
  const bad = new Uint8Array([0x61, 0xff, 0xfe, 0x62]);
  await rejects(craft([{ name: "a.toml", data: bad }]), /a\.toml is not valid UTF-8/);
  await rejects(craft([{ name: "a.toml", data: bad, deflate: true }]), /a\.toml is not valid UTF-8/);
});

test("rejects a checksum mismatch", async () => {
  await rejects(craft([{ name: "a.toml", data: text("x"), crc: 1 }]), /checksum/);
});

test("rejects an entry over the entry cap by its header, before inflating", async () => {
  const big = new Uint8Array(DEFAULT_ZIP_LIMITS.max_entry_bytes + 1).fill(0x61);
  await rejects(craft([{ name: "a.toml", data: big }]), /entry too large/);
  assert.throws(() => write_zip({ "a.toml": "a".repeat(DEFAULT_ZIP_LIMITS.max_entry_bytes + 1) }), /entry too large/);
});

test("rejects a total over the cap while each entry is under the entry cap", async () => {
  const half = new Uint8Array(DEFAULT_ZIP_LIMITS.max_total_bytes / 2 + 1).fill(0x61);
  await rejects(craft([{ name: "a.toml", data: half }, { name: "b.toml", data: half }]), /archive too large/);
  assert.throws(() => write_zip({ a: "x".repeat(half.length), b: "x".repeat(half.length) }), /archive too large/);
});

test("rejects too many entries", async () => {
  const many = Array.from({ length: DEFAULT_ZIP_LIMITS.max_entries + 1 }, (_, i) => ({ name: `f${i}.toml`, data: text("x") }));
  await rejects(craft(many), /too many entries/);
  assert.throws(() => write_zip(Object.fromEntries(many.map((e) => [e.name, "x"]))), /too many entries/);
  const at_cap = many.slice(0, DEFAULT_ZIP_LIMITS.max_entries);
  assert.equal((await read_zip(craft(at_cap))).size, DEFAULT_ZIP_LIMITS.max_entries);
});

test("a 1 MiB entry of zeros that is within the caps reads fine", async () => {
  const zeros = new Uint8Array(1024 * 1024);
  const files = await read_zip(craft([{ name: "a.toml", data: zeros, deflate: true }]));
  assert.equal(files.get("a.toml")!.length, zeros.length);
});

test("rejects a deflated entry whose compressed size is out of proportion to its declared size", async () => {
  const noise = new Uint8Array(200_000).map((_, i) => (i * 7919) & 0xff);
  await rejects(craft([{ name: "a.toml", data: noise, deflate: true, declared_size: 100 }]), /not plausible/);
});

test("rejects a bomb whose header lies about the size", async () => {
  const zeros = new Uint8Array(1024 * 1024);
  // Header claims 1500 bytes, enough to pass the compressed-size check. The stream holds 1 MiB.
  const lying = craft([{ name: "a.toml", data: zeros, deflate: true, declared_size: 1500, crc: 0 }]);
  await rejects(lying, /larger than its header says/);
  // Header claims more than the stream holds.
  const body = text("key = 1\n".repeat(20));
  await rejects(craft([{ name: "a.toml", data: body, deflate: true, declared_size: body.length + 5 }]), /smaller than its header says/);
});

test("rejects two directory entries that point at one local record", async () => {
  // "./a.toml" and "a.toml" are one path to the local-name check, so only the shared offset can fail. Structure is checked before duplicates.
  const bytes = craft([
    { name: "a.toml", data: text("hello") },
    { name: "./a.toml", data: text("hello"), local_offset: 0, local_name: "a.toml" },
  ]);
  await rejects(bytes, /overlapping/);
});

test("rejects an entry whose data runs into the next entry", async () => {
  const first = text("0123456789");
  const bytes = craft([
    { name: "a.toml", data: first, declared_size: 20, declared_compressed: 20, crc: 0 },
    { name: "b.toml", data: text("second entry") },
  ]);
  await rejects(bytes, /overlapping/);
});

test("rejects an entry whose data runs into the central directory", async () => {
  await rejects(craft([{ name: "a.toml", data: text("abc"), declared_size: 3000, declared_compressed: 3000 }]), /past the archive/);
});

test("rejects a local header whose name differs from the directory", async () => {
  await rejects(craft([{ name: "safe.toml", data: text("x"), local_name: "other.toml" }]), /local header name differs/);
});

test("rejects a central directory offset that points into the middle of nowhere", async () => {
  const bytes = craft([{ name: "a.toml", data: text("x") }]);
  new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 3, true);
  await rejects(bytes, /does not fit/);
});

test("rejects a local offset that does not point at a local header", async () => {
  await rejects(craft([{ name: "a.toml", data: text("x"), local_offset: 5 }]), /bad local header/);
});

test("rejects zip64 and multi-disk markers", async () => {
  const bytes = craft([{ name: "a.toml", data: text("x") }]);
  const zip64 = bytes.slice();
  new DataView(zip64.buffer).setUint16(zip64.length - 22 + 10, 0xffff, true);
  new DataView(zip64.buffer).setUint16(zip64.length - 22 + 8, 0xffff, true);
  await rejects(zip64, /zip64/);
  const multi = bytes.slice();
  new DataView(multi.buffer).setUint16(multi.length - 22 + 4, 1, true);
  await rejects(multi, /multi-disk/);
});
