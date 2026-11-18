// The which-key panel's sheet. Pure text, so another host can import it.

const CHAMFER_PX = 8;
const chamfer = (cut: number) =>
  `polygon(${cut}px 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% calc(100% - ${cut}px), calc(100% - ${cut}px) 100%, ${cut}px 100%, 0 calc(100% - ${cut}px), 0 ${cut}px)`;

// The look follows the Oasis editor float: a thin tinted border, a filled title chip, yellow keys, blue groups.
// --bg and --fg alias the page-wide `--desertfox-*` settings, each with its default as a fallback.
export const STYLE = `
.desertfox-whichkey {
  --bg: var(--desertfox-bg-core, #0c0e13);
  --fg: var(--desertfox-fg-core, #f5f5dc);
  --primary: var(--desertfox-primary, #7fa3c9);
  --secondary: var(--desertfox-secondary, #f0e68c);
  --border: color-mix(in srgb, var(--primary) 60%, var(--bg));
  --dim: color-mix(in srgb, var(--fg) 55%, var(--bg));
  position: fixed; right: 16px; bottom: calc(44px * var(--desertfox-font-scale, 1)); max-width: calc(100vw - 32px);
  font: var(--desertfox-font, calc(14px * var(--desertfox-font-scale, 1)) var(--desertfox-font-family, system-ui, sans-serif));
}
.frame { background: var(--border); padding: 1px; }
.body { box-sizing: border-box; background: var(--bg); color: var(--fg); padding: 14px 14px 8px; overflow: auto; max-height: calc(100vh - 98px * var(--desertfox-font-scale, 1)); }
.round, .round .body { border-radius: var(--desertfox-radius, 6px); }
.chamfer { clip-path: ${chamfer(CHAMFER_PX)}; }
.chamfer .body { clip-path: ${chamfer(CHAMFER_PX - 1)}; }
.title { position: relative; width: fit-content; height: 12px; margin: 0 12px -1px; padding: 0 4px; z-index: 1;
  background: linear-gradient(to bottom, transparent 11px, var(--bg) 11px, var(--bg) 12px, transparent 12px); }
.chip { box-sizing: border-box; max-width: calc(100vw - 64px); overflow: hidden; text-overflow: ellipsis; background: var(--primary); color: var(--bg); font-weight: bold; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
.rows { display: grid; column-gap: 24px; }
.row { display: flex; height: calc(22px * var(--desertfox-font-scale, 1)); line-height: calc(22px * var(--desertfox-font-scale, 1)); white-space: nowrap; overflow: hidden; }
.key { color: var(--secondary); min-width: 3ch; }
.arrow { color: var(--dim); padding-right: 8px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.group .label { color: var(--primary); font-weight: bold; }
.footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--fg) 15%, var(--bg)); text-align: center; color: var(--dim); font-style: italic; }
.repeat { margin-top: 4px; font-style: normal; white-space: nowrap; }
.footer span { font-style: normal; color: var(--secondary); font-size: 0.8em; margin: 0 4px 0 14px; }`;
