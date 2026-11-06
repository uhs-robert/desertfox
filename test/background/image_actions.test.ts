import assert from "node:assert/strict";
import { test } from "node:test";
import { file_name_for, MAX_IMAGE_BYTES, run_image_action, sniff_kind, type ImageDeps } from "../../src/background/image_actions.ts";

const bytes_of = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;
const ascii = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const PNG = bytes_of(0x89, 0x50, 0x4e, 0x47, 1, 2);
const JPEG = bytes_of(0xff, 0xd8, 0xff, 0xe0, 1);
const GIF = ascii("GIF89a....");
const WEBP = ascii("RIFF\0\0\0\0WEBPVP8 ");
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function fake(body: ArrayBuffer | Error, extra: { ok?: boolean; declared?: number; set_fails?: boolean; render_fails?: boolean; fetch_fails?: boolean } = {}) {
  const calls: string[] = [];
  const log = { set: [] as Array<[ArrayBuffer, string]>, rendered: [] as string[], saved: [] as Array<[string, string]> };
  const deps: ImageDeps = {
    fetch_image: async (address) => {
      calls.push(`fetch ${address}`);
      if (extra.fetch_fails) throw new Error("network");
      return { ok: extra.ok ?? true, declared_bytes: extra.declared, read: async () => (body instanceof Error ? Promise.reject(body) : body) };
    },
    render_png: async (_bytes, kind) => {
      if (extra.render_fails) throw new Error("decode");
      log.rendered.push(kind);
      return PNG;
    },
    set_image_data: async (bytes, type) => {
      if (extra.set_fails) throw new Error("clipboard");
      log.set.push([bytes, type]);
    },
    save_file: async (bytes, mime, filename) => void log.saved.push([`${mime} ${bytes.byteLength}`, filename]),
  };
  return { deps, log, calls };
}

const copy = (deps: ImageDeps, address = "https://example.com/a.bin") => run_image_action(deps, { type: "image_action", action: "copy_image", address });
const download = (deps: ImageDeps, address: string) => run_image_action(deps, { type: "image_action", action: "download", address });

test("PNG and JPEG reach the clipboard unchanged, with their type from the first bytes", async () => {
  for (const [body, type] of [[PNG, "png"], [JPEG, "jpeg"]] as const) {
    const { deps, log } = fake(body);
    assert.deepEqual(await copy(deps), { ok: true });
    assert.deepEqual(log.set, [[body, type]]);
    assert.deepEqual(log.rendered, []);
  }
});

test("WebP, GIF and SVG convert to PNG before they reach the clipboard", async () => {
  for (const [body, kind] of [[WEBP, "webp"], [GIF, "gif"], [SVG, "svg"]] as const) {
    const { deps, log } = fake(body);
    assert.deepEqual(await copy(deps), { ok: true });
    assert.deepEqual(log.rendered, [kind]);
    assert.deepEqual(log.set, [[PNG, "png"]]);
  }
});

test("sniff_kind reads the bytes, not a header", () => {
  assert.equal(sniff_kind(ascii("BM......")), "bmp");
  assert.equal(sniff_kind(ascii("\0\0\0\x1cftypavif")), "avif");
  assert.equal(sniff_kind(ascii("<html>")), "unknown");
});

test("a picture over 20 MB refuses, by header and by size, and never touches the clipboard", async () => {
  const by_header = fake(PNG, { declared: MAX_IMAGE_BYTES + 1 });
  assert.deepEqual(await copy(by_header.deps), { ok: false, message: "Image is over 20 MB" });
  const by_size = fake(new ArrayBuffer(MAX_IMAGE_BYTES + 1));
  assert.deepEqual(await copy(by_size.deps), { ok: false, message: "Image is over 20 MB" });
  assert.deepEqual([by_header.log.set, by_size.log.set], [[], []]);
});

test("a fetch error, a bad status, a failed read and a foreign scheme refuse and leave the clipboard", async () => {
  const cases = [fake(PNG, { fetch_fails: true }), fake(PNG, { ok: false }), fake(new Error("cut"))];
  for (const { deps, log } of cases) {
    assert.deepEqual(await copy(deps), { ok: false, message: "Could not fetch the image" });
    assert.deepEqual(log.set, []);
  }
  const foreign = fake(PNG);
  assert.deepEqual(await copy(foreign.deps, "file:///etc/passwd"), { ok: false, message: "Could not fetch the image" });
  assert.deepEqual(foreign.calls, []);
});

test("a failed conversion and a failed clipboard write refuse, each naming its step", async () => {
  const render = fake(WEBP, { render_fails: true });
  assert.deepEqual(await copy(render.deps), { ok: false, message: "Could not convert the image" });
  assert.deepEqual(render.log.set, []);
  const write = fake(PNG, { set_fails: true });
  assert.deepEqual(await copy(write.deps), { ok: false, message: "Could not copy the image to the clipboard" });
});

test("a message from a page with a bad action or address refuses", async () => {
  const { deps } = fake(PNG);
  assert.equal((await run_image_action(deps, { type: "image_action", action: "wipe" as never, address: "https://example.com/a.png" })).ok, false);
  assert.equal((await run_image_action(deps, { type: "image_action", action: "download", address: 5 as never })).ok, false);
});

test("download saves the fetched bytes under the last path segment, with no size cap", async () => {
  const { deps, log } = fake(new ArrayBuffer(MAX_IMAGE_BYTES + 5), {});
  assert.deepEqual(await download(deps, "https://example.com/pics/cat%20one.png?size=2"), { ok: true });
  assert.deepEqual(log.saved, [[`application/octet-stream ${MAX_IMAGE_BYTES + 5}`, "cat one.png"]]);
});

test("download names a file with no usable segment image plus the sniffed extension", async () => {
  assert.equal(file_name_for("https://example.com/", "webp"), "image.webp");
  assert.equal(file_name_for("data:image/png;base64,AAAA", "png"), "image.png");
  assert.equal(file_name_for("https://example.com/a/%2Fb", "unknown"), "download");
  assert.equal(file_name_for("https://example.com/..", "jpeg"), "image.jpg");
});

test("a failed fetch or save refuses a download", async () => {
  assert.deepEqual(await download(fake(PNG, { ok: false }).deps, "https://example.com/a.png"), { ok: false, message: "Could not fetch the image" });
  const { deps } = fake(PNG);
  deps.save_file = async () => Promise.reject(new Error("disk"));
  assert.deepEqual(await download(deps, "https://example.com/a.png"), { ok: false, message: "Could not save the file" });
});
