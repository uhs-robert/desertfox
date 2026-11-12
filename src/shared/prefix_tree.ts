// Compiled keymap: the background writes it to `storage.local` under
// COMPILED_KEYMAP_STORAGE_KEY. A page gets it from the background as a PageKeymap, trimmed for its site, before the first key.

import type { BundleName } from "./bundles.ts";
import type { CountBehavior, RunsIn } from "./command.ts";
import type { BoundInvocation } from "./invocation.ts";
import type { ModeIndicator, WhichKeyBorder } from "./config.ts";
import type { KeymapMode } from "./keymap.ts";
import type { PerSiteName, Settings } from "./settings_table.ts";

export const COMPILED_KEYMAP_STORAGE_KEY = "desertfox_compiled_keymap";

export const COMPILED_KEYMAP_VERSION = 7;

// One step of a binding. The side that runs it and the count rule are resolved at compile time.
export type LeafStep = {
  invocation: BoundInvocation;
  runs_in: RunsIn;
  // How a numeric prefix applies, copied from the registry because the content script has none.
  count_rule: CountBehavior;
  // The lazy bundle that holds the command, copied from the registry.
  bundle?: BundleName;
  // The name of the `key` param this step waits on: the key press after the leaf fills it. The matcher fills it from the key that reaches the leaf, which sits under `ANY_KEY`.
  capture?: string;
  // The command has a `register` param, so the matcher fills it from a `"<reg>` typed before the leaf.
  register?: true;
};

export type TreeLeaf = {
  kind: "leaf";
  // The which-key label of the key. The content script cannot load commands.json.
  label?: string;
  // The which-key hover text the binding wrote. Without one the row shows the command intent.
  intent?: string;
  steps: LeafStep[];
};

// The child key of a branch whose leaf waits for one key press. The press is the leaf's `key` param, so the branch binds no token of its own.
export const ANY_KEY = "";

// How a key listing writes a token: the capture child reads `<key>`, so `m` then any key lists as `m<key>`.
export const token_label = (token: string): string => (token === ANY_KEY ? "<key>" : token);

export type TreeBranch = {
  kind: "branch";
  // The group name which-key shows. Without one it shows the prefix key.
  label?: string;
  // Keyed by one normalized key token, for example `g` or `<A-j>`.
  children: Record<string, TreeNode>;
};

export type TreeNode = TreeLeaf | TreeBranch;

// One `site_rules` row with its columns (see `SiteColumns` in `match_pattern.ts`). `keys` holds parsed key sequences, one token array each. The background prunes the normal tree with them for each page, so the stored keymap does not grow a tree per rule.
// `off` is set from `off` or a row with nothing but `site`. The background also treats a page as all off when its key rule leaves no normal binding.
// `modes` holds each site mode with its own binds, compiled as `bind` is. A page grafts them on its own, never on the stored tree.
// `bind` maps a normalized key sequence to its tokens and compiled leaf. The background grafts the merged binds onto the normal tree before it prunes.
export type SiteBind = { tokens: string[]; leaf: TreeLeaf };
export type SiteRule = { regex: string; off?: boolean; keys?: { pass: string[][] } | { only: string[][] }; bind?: Record<string, SiteBind>; modes?: Record<string, { label: string; bind: Record<string, SiteBind> }>; values?: Readonly<Record<string, unknown>> };

export type CompiledKeymap = {
  format_version: typeof COMPILED_KEYMAP_VERSION;
  // Root branch per mode. A mode without bindings is absent.
  modes: Partial<Record<KeymapMode, TreeBranch>>;
  // Settings the content script needs before it can handle a key.
  // In list order. Each column takes the first rule that fits the page and sets it. Absent when no rule exists.
  site_rules?: SiteRule[];
  mode_indicator: ModeIndicator;
  // Set when the `bridge` setting is on. The background reads it to open the bridge port. Pages ignore it.
  bridge?: true;
  // Set when `bridge_share_tabs` is on as well. The bridge then answers the tab verbs. Pages ignore it.
  bridge_share_tabs?: true;
  // The global values of the frame site settings, each only when it differs from its default. The background resolves them with the page's site rows into `site_values`, so pages never see this field.
  frame_site_globals?: FrameSiteValues;
  // Set only on the keymap published while DesertFox is switched off. The page then lets a lone keyup through.
  off?: true;
  which_key_delay_ms: number;
  // Typed-key strings (tokens joined) of the prefixes that open no panel by themselves. Absent when none.
  which_key_skip?: string[];
  // A tree stored before this setting has none, and the panel keeps square corners.
  which_key_border?: WhichKeyBorder;
};

// What the background sends a page: the keymap without `site_rules`, its normal tree already trimmed when the page's rule lists keys.
// `all_off` keeps the whole tree so `,i` can leave ignore mode. `frees` is set only for a listed-keys rule.
export type PageFrees = { tokens: string[]; invert: boolean };
export const is_freed = ({ tokens, invert }: PageFrees, token: string): boolean => tokens.includes(token) !== invert;
// `insert` is set while a manual insert mode (`i`) holds the tab, so a frame that loads late joins it. `recording` is the register a macro is being recorded into. The tree then holds `macro.stop` where the record key was, and the badge says so.
// The per-site settings that act inside one frame, so each frame resolves them against its own address.
// The page keymap reply carries only the ones content.js needs. The hints bundle asks for the hint selectors itself (`read_hint_selectors`), so content.js does not grow.
export const PAGE_REPLY_SITE_SETTINGS = ["blur_on_load", "escape_to_page"] as const satisfies readonly PerSiteName[];
export const HINT_SITE_SETTINGS = ["hint_add", "hint_remove"] as const satisfies readonly PerSiteName[];
// The quality bundle asks for its own (`read_media_quality`).
export const QUALITY_SITE_SETTINGS = ["media_quality"] as const satisfies readonly PerSiteName[];
// A literal, not a spread of the lists: the bundler keeps an unused spread in content.js.
export const FRAME_SITE_SETTINGS = ["blur_on_load", "escape_to_page", "hint_add", "hint_remove", "media_quality"] as const satisfies readonly [...typeof PAGE_REPLY_SITE_SETTINGS, ...typeof HINT_SITE_SETTINGS, ...typeof QUALITY_SITE_SETTINGS];
export type FrameSiteName = (typeof FRAME_SITE_SETTINGS)[number];
export type FrameSiteValues<Name extends FrameSiteName = FrameSiteName> = Partial<Pick<Settings, Name>>;

// `site_values` holds the page reply site settings resolved for the frame's own address, each only when it differs from its default.
// What a site mode adds to the page's normal tree: its badge label and the top-level children that differ from the normal tree, which the content script lays over it.
export type PageSiteMode = { label: string; tree: Record<string, TreeNode> };

export type PageKeymap = { keymap: Omit<CompiledKeymap, "site_rules" | "frame_site_globals">; all_off: boolean; site_modes?: Record<string, PageSiteMode>; frees?: PageFrees; recording?: string; join?: "insert" | "media"; site_values?: FrameSiteValues<(typeof PAGE_REPLY_SITE_SETTINGS)[number]> };

// A tree stored by an older build has another shape, and the page then gets no keymap until the background recompiles.
export const current_keymap = (stored: CompiledKeymap | undefined): CompiledKeymap | undefined =>
  stored?.format_version === COMPILED_KEYMAP_VERSION ? stored : undefined;
