// Copy a picture to the clipboard, or save a file, from an address a hint picked. The background does it all, because its host permission lets a fetch cross sites.

import { RuntimeRefusal } from "../shared/command.ts";
import type { ImageAction, Outcome } from "../shared/messages.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageKind = "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "unknown";

export type FetchedImage = {
  ok: boolean;
  // The `Content-Length` header, when the server sent one.
  declared_bytes: number | undefined;
  read: () => Promise<ArrayBuffer>;
};

export type ImageDeps = {
  fetch_image: (address: string) => Promise<FetchedImage>;
  // Decodes any picture the browser can draw and returns it as PNG. A GIF gives its first frame.
  render_png: (bytes: ArrayBuffer, kind: ImageKind) => Promise<ArrayBuffer>;
  set_image_data: (bytes: ArrayBuffer, type: "png" | "jpeg") => Promise<void>;
  // Resolves when the download ends and the temporary address is released.
  save_file: (bytes: ArrayBuffer, mime: string, filename: string) => Promise<void>;
};

const starts_with = (head: Uint8Array, ...bytes: number[]): boolean => bytes.every((byte, index) => head[index] === byte);
const text_at = (head: Uint8Array, from: number, length: number): string => String.fromCharCode(...head.subarray(from, from + length));

// The type comes from the first bytes, because a server's `Content-Type` is often wrong or missing.
export function sniff_kind(bytes: ArrayBuffer): ImageKind {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 512));
  if (starts_with(head, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts_with(head, 0xff, 0xd8, 0xff)) return "jpeg";
  if (text_at(head, 0, 4) === "GIF8") return "gif";
  if (text_at(head, 0, 4) === "RIFF" && text_at(head, 8, 4) === "WEBP") return "webp";
  if (text_at(head, 0, 2) === "BM") return "bmp";
  if (text_at(head, 4, 8) === "ftypavif") return "avif";
  if (/<svg[\s>]/.test(new TextDecoder().decode(head))) return "svg";
  return "unknown";
}

const MIME: Record<ImageKind, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml", unknown: "application/octet-stream" };
const EXTENSION: Record<ImageKind, string> = { png: ".png", jpeg: ".jpg", gif: ".gif", webp: ".webp", bmp: ".bmp", avif: ".avif", svg: ".svg", unknown: "" };

// The last path segment of the address. A `data:` address, an address that ends in a slash and a segment with a separator in it have none.
export function file_name_for(address: string, kind: ImageKind): string {
  const segment = URL.canParse(address) && !address.startsWith("data:") ? new URL(address).pathname.split("/").pop() ?? "" : "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keeps the raw segment.
  }
  const usable = decoded !== "" && !/[\\/\0]/.test(decoded) && !/^\.+$/.test(decoded);
  return usable ? decoded : `${kind === "unknown" ? "download" : "image"}${EXTENSION[kind]}`;
}

const FETCHABLE = /^(https?|data):/i;

async function fetch_bytes(deps: ImageDeps, address: string, limit: number | undefined): Promise<ArrayBuffer> {
  if (!FETCHABLE.test(address)) throw new RuntimeRefusal("Could not fetch the image");
  let fetched: FetchedImage;
  try {
    fetched = await deps.fetch_image(address);
  } catch {
    throw new RuntimeRefusal("Could not fetch the image");
  }
  if (!fetched.ok) throw new RuntimeRefusal("Could not fetch the image");
  if (limit !== undefined && fetched.declared_bytes !== undefined && fetched.declared_bytes > limit) throw new RuntimeRefusal("Image is over 20 MB");
  let bytes: ArrayBuffer;
  try {
    bytes = await fetched.read();
  } catch {
    throw new RuntimeRefusal("Could not fetch the image");
  }
  if (limit !== undefined && bytes.byteLength > limit) throw new RuntimeRefusal("Image is over 20 MB");
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

// No size cap: a download holds a video or a link target as well, and the cap guards the clipboard.
async function download(deps: ImageDeps, address: string): Promise<void> {
  const bytes = await fetch_bytes(deps, address, undefined);
  const kind = sniff_kind(bytes);
  try {
    await deps.save_file(bytes, MIME[kind], file_name_for(address, kind));
  } catch {
    throw new RuntimeRefusal("Could not save the file");
  }
}

// The request comes from a page script, so its fields are checked here.
export async function run_image_action(deps: ImageDeps, request: ImageAction): Promise<Outcome> {
  try {
    if (typeof request.address !== "string") throw new RuntimeRefusal("Could not fetch the image");
    if (request.action === "copy_image") await copy_image(deps, request.address);
    else if (request.action === "download") await download(deps, request.address);
    else throw new RuntimeRefusal("Unknown picture action");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof RuntimeRefusal ? error.message : "The picture action failed" };
  }
}
