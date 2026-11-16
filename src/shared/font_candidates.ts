// The font names the pickers offer when no host lists the installed fonts, and the canvas probe that keeps the ones this browser has. The names are common on Windows, macOS and Linux, plus the coding fonts people install by hand.
// The probe runs in an extension page only (it needs a canvas), never in a content script or the command line page.

import { parse_font_family } from "./theme/font_family.ts";

export const MAX_FONT_NAMES = 2000;

export const FONT_CANDIDATES: readonly string[] = [
  "Arial", "Arial Black", "Arial Narrow", "Bahnschrift", "Book Antiqua", "Bookman Old Style", "Calibri", "Cambria", "Cambria Math", "Candara", "Century Gothic", "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Courier New", "Franklin Gothic Medium", "Garamond", "Georgia", "Impact", "Lucida Console", "Lucida Sans Unicode", "Microsoft Sans Serif", "Palatino Linotype", "Segoe UI", "Segoe UI Symbol", "Sylfaen", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
  "American Typewriter", "Andale Mono", "Avenir", "Avenir Next", "Baskerville", "Big Caslon", "Chalkboard", "Cochin", "Copperplate", "Courier", "Didot", "Futura", "Geneva", "Gill Sans", "Helvetica", "Helvetica Neue", "Hoefler Text", "Lucida Grande", "Marker Felt", "Menlo", "Monaco", "Optima", "Palatino", "Papyrus", "SF Mono", "SF Pro", "San Francisco", "Skia", "Zapfino",
  "Bitstream Vera Sans", "Bitstream Vera Sans Mono", "Bitstream Vera Serif", "C059", "Cantarell", "DejaVu Sans", "DejaVu Sans Mono", "DejaVu Serif", "Droid Sans", "Droid Sans Mono", "Droid Serif", "FreeMono", "FreeSans", "FreeSerif", "Liberation Mono", "Liberation Sans", "Liberation Sans Narrow", "Liberation Serif", "Nimbus Mono PS", "Nimbus Roman", "Nimbus Sans", "Noto Color Emoji", "Noto Mono", "Noto Sans", "Noto Sans CJK JP", "Noto Sans Mono", "Noto Serif", "Noto Serif CJK JP", "Open Sans", "P052", "Roboto", "Roboto Condensed", "Roboto Mono", "Roboto Slab", "Terminus", "Ubuntu", "Ubuntu Condensed", "Ubuntu Mono", "URW Gothic", "Z003",
  "Anonymous Pro", "Atkinson Hyperlegible", "Cascadia Code", "Cascadia Mono", "Commit Mono", "Fira Code", "Fira Mono", "Fira Sans", "Fira Sans Condensed", "Geist Mono", "Hack", "Hasklig", "IBM Plex Mono", "IBM Plex Sans", "IBM Plex Serif", "Inconsolata", "Inter", "Iosevka", "JetBrains Mono", "Lato", "Lora", "Merriweather", "Monaspace Neon", "Montserrat", "Mononoki", "Nunito", "Oxygen", "Oxygen Mono", "PT Mono", "PT Sans", "PT Serif", "Playfair Display", "Poppins", "Source Code Pro", "Source Sans 3", "Source Sans Pro", "Source Serif 4", "Source Serif Pro", "Space Mono", "Victor Mono", "Work Sans",
  "FiraCode Nerd Font", "FiraCode Nerd Font Mono", "Hack Nerd Font", "Hack Nerd Font Mono", "Iosevka Nerd Font", "JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "MesloLGS NF", "Symbols Nerd Font", "Symbols Nerd Font Mono",
];

export type MeasureWidth = (font: string) => number;

const PROBE_TEXT = "mmmmmmmmmmlli0Oo";
// A name that is not installed falls back to the generic family after it, so its width equals the generic's. Two generics with different glyph widths, so a name that happens to match one of them still differs from the other.
const FALLBACKS = ["monospace", "serif"] as const;

// The names of `candidates` that this browser draws with a face of its own. `measure` takes a CSS font shorthand and gives the width of a fixed text.
export function probe_fonts(candidates: readonly string[], measure: MeasureWidth): string[] {
  const bare = FALLBACKS.map((fallback) => measure(`72px ${fallback}`));
  return candidates.filter((name) => FALLBACKS.some((fallback, index) => measure(`72px "${name}", ${fallback}`) !== bare[index]));
}

// One width per call, from a canvas. Undefined where there is no document to make one in.
export function canvas_measure(): MeasureWidth | undefined {
  if (typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  return (font) => {
    context.font = font;
    return context.measureText(PROBE_TEXT).width;
  };
}

// One usable name per entry: the ones the font setting's parser takes as a single family. The first spelling of a name wins, case aside. Case-insensitive order, cut to the cap.
export function merge_font_names(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Map<string, string>();
  for (const name of lists.flat()) {
    const family = parse_font_family(name);
    const key = name.toLowerCase();
    if (family !== undefined && family !== "" && !name.includes(",") && !seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).slice(0, MAX_FONT_NAMES);
}
