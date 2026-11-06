// Copy a picture to the clipboard, or save a file, from an address a hint picked. The background does it all, because its host permission lets a fetch cross sites.

import { RuntimeRefusal } from "../shared/command.ts";
import type { ImageAction, Outcome } from "../shared/messages.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageKind = "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "unknown";

export type FetchedImage = {
  ok: boolean;
  // The `Content-Length` header, when the server sent one.
  declared_bytes: number | undefined;
  // Undefined when the body is longer than `limit`: the read stops there, so a server that sends no length cannot fill the memory.
  read: (limit: number) => Promise<ArrayBuffer | undefined>;
};

// The tab the pick came from, so a download keeps its private window and container.
export type TabContext = { incognito: boolean; cookie_store_id: string | undefined };

export const FETCH_TIMEOUT_MS = 20_000;

export type ImageDeps = {
  // Rejects with a `TimeoutError` when the fetch or the body read runs past `timeout_ms`.
  fetch_image: (address: string, timeout_ms: number) => Promise<FetchedImage>;
  // Decodes any picture the browser can draw and returns it as PNG. A GIF gives its first frame.
  render_png: (bytes: ArrayBuffer, kind: ImageKind) => Promise<ArrayBuffer>;
  set_image_data: (bytes: ArrayBuffer, type: "png" | "jpeg") => Promise<void>;
  // Hands the address to the browser, which saves it with the server's file name. Resolves once the download has started.
  start_download: (address: string, context: TabContext) => Promise<void>;
};

const starts_with = (head: Uint8Array, ...bytes: number[]): boolean => bytes.every((byte, index) => head[index] === byte);
const text_at = (head: Uint8Array, from: number, length: number): string => String.fromCharCode(...head.subarray(from, from + length));

// The type comes from the first bytes, because a server's `Content-Type` is often wrong or missing.
// Long enough for an SVG whose prolog, comments or DOCTYPE come before the root element.
const SNIFF_BYTES = 64 * 1024;

export function sniff_kind(bytes: ArrayBuffer): ImageKind {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, SNIFF_BYTES));
  if (starts_with(head, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts_with(head, 0xff, 0xd8, 0xff)) return "jpeg";
  if (text_at(head, 0, 4) === "GIF8") return "gif";
  if (text_at(head, 0, 4) === "RIFF" && text_at(head, 8, 4) === "WEBP") return "webp";
  if (text_at(head, 0, 2) === "BM") return "bmp";
  if (text_at(head, 4, 8) === "ftypavif") return "avif";
  if (/<svg[\s>]/.test(new TextDecoder().decode(head))) return "svg";
  return "unknown";
}

const FETCHABLE = /^(https?|data):/i;

const is_timeout = (error: unknown): boolean => (error as { name?: string } | null)?.name === "TimeoutError";

const fetch_failure = (error: unknown): RuntimeRefusal => new RuntimeRefusal(is_timeout(error) ? "The image took too long to fetch" : "Could not fetch the image");

async function fetch_bytes(deps: ImageDeps, address: string, limit: number): Promise<ArrayBuffer> {
  if (!FETCHABLE.test(address)) throw new RuntimeRefusal("Could not fetch the image");
  let fetched: FetchedImage;
  try {
    fetched = await deps.fetch_image(address, FETCH_TIMEOUT_MS);
  } catch (error) {
    throw fetch_failure(error);
  }
  if (!fetched.ok) throw new RuntimeRefusal("Could not fetch the image");
  if (fetched.declared_bytes !== undefined && fetched.declared_bytes > limit) throw new RuntimeRefusal("Image is over 20 MB");
  let bytes: ArrayBuffer | undefined;
  try {
    bytes = await fetched.read(limit);
  } catch (error) {
    throw fetch_failure(error);
  }
  if (bytes === undefined || bytes.byteLength > limit) throw new RuntimeRefusal("Image is over 20 MB");
  return bytes;
}

async function copy_image(deps: ImageDeps, address: string): Promise<void> {
  const bytes = await fetch_bytes(deps, address, MAX_IMAGE_BYTES);
  const kind = sniff_kind(bytes);
  let ready: ArrayBuffer;
  if (kind === "png" || kind === "jpeg") {
    ready = bytes;
  } else {
    try {
      ready = await deps.render_png(bytes, kind);
    } catch {
      throw new RuntimeRefusal("Could not convert the image");
    }
  }
  // Nothing before this call touches the clipboard, so a failed step leaves it as it was.
  try {
    await deps.set_image_data(ready, kind === "jpeg" ? "jpeg" : "png");
  } catch {
    throw new RuntimeRefusal("Could not copy the image to the clipboard");
  }
}

// The browser fetches and saves it, so nothing is buffered here and a `Content-Disposition` name is honored. The same scheme check applies as for a copy.
async function download(deps: ImageDeps, address: string, context: TabContext): Promise<void> {
  if (!FETCHABLE.test(address)) throw new RuntimeRefusal("Could not fetch the image");
  try {
    await deps.start_download(address, context);
  } catch {
    throw new RuntimeRefusal("Could not save the file");
  }
}

// The request comes from a page script, so its fields are checked here.
export async function run_image_action(deps: ImageDeps, request: ImageAction, context: TabContext): Promise<Outcome> {
  try {
    if (typeof request.address !== "string") throw new RuntimeRefusal("Could not fetch the image");
    if (request.action === "copy_image") await copy_image(deps, request.address);
    else if (request.action === "download") await download(deps, request.address, context);
    else throw new RuntimeRefusal("Unknown picture action");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof RuntimeRefusal ? error.message : "The picture action failed" };
  }
}
