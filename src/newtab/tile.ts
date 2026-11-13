// One card for a link, recent tab or bookmark. The whole card is the anchor, so a hint labels it once.
import type { ListRow } from "./lists.ts";

const letter_tile = (host: string): HTMLElement => {
  const tile = document.createElement("span");
  tile.className = "tile-icon tile-letter";
  tile.textContent = (host[0] ?? "?").toUpperCase();
  return tile;
};

// A failed load swaps the image for the letter tile, so a dead icon address never leaves a blank box.
const icon_box = (row: ListRow): HTMLElement => {
  const letter = letter_tile(row.host);
  if (!row.icon_url) return letter;
  const image = document.createElement("img");
  image.className = "tile-icon";
  image.src = row.icon_url;
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(letter));
  return image;
};

export function draw_tile(row: ListRow): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className = "desertfox-card tile";
  anchor.href = row.url;
  anchor.title = row.url;
  const title = document.createElement("span");
  title.className = "tile-title";
  title.textContent = row.label || row.host;
  const site = document.createElement("span");
  site.className = "tile-site";
  site.textContent = row.host;
  const text = document.createElement("span");
  text.className = "tile-text";
  text.append(title, site);
  anchor.append(icon_box(row), text);
  return anchor;
}
