import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { answer_config_transfer } from "../../src/background/config_transfer.ts";
import { load_edits } from "../../src/background/config_load.ts";
import { load_layers } from "../../src/background/edit_layers.ts";
import { create_theme_messages } from "../../src/background/theme_message.ts";
import { THEME_EDITS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { plan_set_value } from "../../src/commands/settings.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/config.ts";
import { build_setting_list } from "../../src/shared/setting_list.ts";
import { parse_base16 } from "../../src/shared/theme/base16.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import { load_theme } from "../../src/shared/theme/load.ts";
import { write_zip } from "../../src/shared/zip.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";

type Startup = typeof import("../../src/background/startup.ts");

const SCHEME = `scheme: "Gruvbox dark, medium"
base00: "282828"
base01: "3c3836"
base02: "504945"
base03: "665c54"
base04: "bdae93"
base05: "d5c4a1"
base06: "ebdbb2"
base07: "fbf1c7"
base08: "fb4934"
base09: "fe8019"
base0A: "fabd2f"
base0B: "b8bb26"
base0C: "8ec07c"
base0D: "83a598"
base0E: "d3869b"
base0F: "d65d0e"
`;
const OTHER_SCHEME = SCHEME.replace('"282828"', '"101820"').replace("Gruvbox dark, medium", "Other");
const mapped = (text: string) => {
  const parsed = parse_base16(text);
  assert.ok(parsed.ok);
  return parsed.scheme.theme;
};

async function started(tag: string, files: Files = { "settings.toml": "" }) {
  const host = { files };
  const browser = install_fake_browser(host);
  const startup = (await import(`../../src/background/startup.ts?imported_themes_${tag}`)) as Startup;
  await startup.get_config();
  await startup.reload_config();
  const messages = create_theme_messages({
    read_theme_edits: startup.read_theme_edits,
    change_layers: startup.change_layers,
    release_theme: (name) =>
      startup.change_edits((current) => {
        const drop = (layer: typeof current.saved) => (layer.theme === name ? Object.fromEntries(Object.entries(layer).filter(([key]) => key !== "theme")) : layer);
        return current.saved.theme === name ? { saved: drop(current.saved), temp: drop(current.temp) } : undefined;
      }),
  });
  const export_all = async () => {
    const answer = await answer_config_transfer({ type: "export_config" }, {
      read_files: async () => host.files,
      read_saved: async () => (await load_edits()).saved,
      read_keymap_edits: async () => ({ edits: {}, skipped: [] }),
      read_themes: startup.read_theme_edits,
      remove: startup.remove_snippet,
    });
    assert.ok(answer.ok);
    return answer as Extract<typeof answer, { config_files: unknown }>;
  };
  const set_theme = (name: string) =>
    startup.change_edits((current, config) => {
      const plan = plan_set_value("theme", name, "saved", current, config);
      assert.equal(plan.toast.kind, "success", plan.toast.message);
      return plan.next;
    });
  return { host, startup, messages, export_all, set_theme, ...browser };
}

const save = (name: string, text: string, replace = false) => ({ type: "change_imported_themes", action: "save", name, text, ...(replace && { replace }) }) as const;

test("a saved scheme is stored whole, :set theme accepts its name, and the published theme is the mapped one", async () => {
  const { messages, startup, local, set_theme } = await started("save");
  const answer = await messages.change(save("gruvbox", SCHEME));
  assert.equal(answer.ok, true);
  assert.deepEqual(Object.keys(local[THEME_EDITS_STORAGE_KEY] as object), ["gruvbox"]);
  assert.deepEqual(local[THEME_EDITS_STORAGE_KEY], { gruvbox: mapped(SCHEME) });
  assert.deepEqual(await messages.list(), { ok: true, names: ["gruvbox"] });

  await set_theme("gruvbox");
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));
  assert.equal(load_theme("gruvbox", 3, (await startup.get_config()).local_themes)?.dark.bg_core, "#282828");
});

test(":set theme to an unknown name still warns, so only imported names are new", async () => {
  const { startup } = await started("unknown");
  await startup.change_edits((current, config) => {
    const plan = plan_set_value("theme", "gruvbox", "saved", current, config);
    assert.equal(plan.toast.kind, "warning");
    return undefined;
  });
});

test("a malformed, partial or misnamed scheme is refused and leaves the stored list as it was", async () => {
  const { messages, local } = await started("refused");
  await messages.change(save("keep", SCHEME));
  const before = structuredClone(local[THEME_EDITS_STORAGE_KEY]);
  const partial = SCHEME.replace(/base0[ef].*\n/gi, "");
  for (const [name, text, pattern] of [
    ["half", partial, /lacks base0E, base0F/],
    ["junk", "base00: nope\n", /not a six-digit hex color/],
    ["oasis_cactus", SCHEME, /built-in/],
    ["desktop", SCHEME, /built-in/],
    ["Bad Name", SCHEME, /lowercase/],
    ["__proto__", SCHEME, /lowercase/],
  ] as const) {
    const answer = await messages.change(save(name, text));
    assert.equal(answer.ok, false, name);
    assert.match(answer.message, pattern);
  }
  assert.equal((await messages.change({ type: "change_imported_themes", action: "save", name: 5, text: SCHEME } as never)).ok, false);
  assert.deepEqual(local[THEME_EDITS_STORAGE_KEY], before);
});

test("saving over a name asks first and replaces only when told to", async () => {
  const { messages, local } = await started("replace");
  await messages.change(save("mine", SCHEME));
  const asked = await messages.change(save("mine", OTHER_SCHEME));
  assert.deepEqual([asked.ok, "needs_replace" in asked && asked.needs_replace], [false, true]);
  assert.deepEqual(local[THEME_EDITS_STORAGE_KEY], { mine: mapped(SCHEME) });
  const replaced = await messages.change(save("mine", OTHER_SCHEME, true));
  assert.equal(replaced.ok, true);
  assert.deepEqual(local[THEME_EDITS_STORAGE_KEY], { mine: mapped(OTHER_SCHEME) });
});

test("a damaged store keeps only the whole themes, so the compile and the export never see a broken one", async () => {
  const { local, startup } = await started("damaged");
  const good = mapped(SCHEME);
  const { accent: _gone, ...no_accent } = good.dark;
  local[THEME_EDITS_STORAGE_KEY] = {
    good,
    no_accent: { dark: no_accent, light: good.light },
    bad_color: { dark: { ...good.dark, primary: "red" }, light: good.light },
    "Bad Name": good,
    __proto__x: good,
    text: "not a theme",
  };
  assert.deepEqual(Object.keys((await load_layers()).themes ?? {}), ["good"]);
  assert.deepEqual(Object.keys(await startup.read_theme_edits()), ["good"]);
  local[THEME_EDITS_STORAGE_KEY] = "garbage";
  assert.equal((await load_layers()).themes, undefined);
});

test("the settings export carries each imported theme, and importing it elsewhere gives the same theme by name", async () => {
  const first = await started("export_a");
  await first.messages.change(save("gruvbox", SCHEME));
  await first.messages.change(save("other", OTHER_SCHEME));
  await first.set_theme("other");
  const exported = (await first.export_all()).config_files;
  assert.deepEqual(Object.keys(exported).filter((path) => path.startsWith("themes/")).sort(), ["themes/gruvbox.toml", "themes/other.toml"]);
  assert.match(exported["settings.d/zz-saved-edits.toml"] ?? "", /theme = "other"/);

  const second = await started("export_b", { "settings.toml": "" });
  await second.startup.import_config({ kind: "zip", bytes: write_zip(exported) }, {});
  const config = await second.startup.get_config();
  assert.deepEqual(config.local_themes?.gruvbox, mapped(SCHEME));
  assert.deepEqual(config.local_themes?.other, mapped(OTHER_SCHEME));
  assert.deepEqual(second.local[THEME_STORAGE_KEY], mapped(OTHER_SCHEME));
  await second.set_theme("gruvbox");
  assert.deepEqual(second.local[THEME_STORAGE_KEY], mapped(SCHEME));
});

test("the import wins over a theme file of the same name, in the running config and in the export", async () => {
  const file_theme = '[dark]\nbg_core = "#000000"\nfg_core = "#ffffff"\nprimary = "#ff0000"\naccent = "#00ff00"\n';
  const { messages, startup, export_all, local } = await started("wins", { "settings.toml": "", "themes/mine.toml": file_theme });
  assert.equal((await startup.get_config()).local_themes?.mine?.dark.bg_core, "#000000");
  await messages.change(save("mine", SCHEME));
  assert.deepEqual((await startup.get_config()).local_themes?.mine, mapped(SCHEME));
  assert.deepEqual(local[THEME_EDITS_STORAGE_KEY], { mine: mapped(SCHEME) });
  const exported = (await export_all()).config_files;
  assert.match(exported["themes/mine.toml"]!, /#282828/);
});

test("the picker lists the imported names after the built-in ones", () => {
  const status = { settings: DEFAULT_SETTINGS, saved: [], temp: [], configured: [] };
  const allowed = build_setting_list(status, ["gruvbox"]).find((row) => row.name === "theme")?.allowed;
  assert.equal(allowed?.at(-1), "gruvbox");
  assert.ok(allowed?.includes("oasis_cactus"));
  assert.equal(build_setting_list(status).find((row) => row.name === "theme")?.allowed?.includes("gruvbox"), false);
});

test("removing the active imported theme falls back to the default with no warning, and the theme edit goes with it", async () => {
  const { messages, startup, local, set_theme } = await started("remove_active");
  await messages.change(save("gruvbox", SCHEME));
  await messages.change(save("other", OTHER_SCHEME));
  await set_theme("gruvbox");
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(SCHEME));

  const removed = await messages.change({ type: "change_imported_themes", action: "remove", name: "gruvbox" });
  assert.equal(removed.ok, true);
  assert.deepEqual(local[THEME_STORAGE_KEY], load_theme("oasis_moonlight", 3));
  assert.deepEqual(Object.keys(local[THEME_EDITS_STORAGE_KEY] as object), ["other"]);
  assert.equal((await startup.get_config()).settings.theme, undefined);
  assert.deepEqual((local[WARNINGS_STORAGE_KEY] as string[]).filter((warning) => warning.includes("theme")), []);
  assert.equal((await messages.change({ type: "change_imported_themes", action: "remove", name: "gruvbox" })).ok, false);
});

test("removing an imported theme that is not in use leaves the setting and the published theme alone, across a restart", async () => {
  const { messages, startup, local, set_theme } = await started("remove_other");
  await messages.change(save("gruvbox", SCHEME));
  await messages.change(save("other", OTHER_SCHEME));
  await set_theme("other");
  await messages.change({ type: "change_imported_themes", action: "remove", name: "gruvbox" });
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(OTHER_SCHEME));
  assert.equal((await startup.get_config()).settings.theme, "other");
  // A restart reads the edit and the stored list again.
  const restarted = (await import(`../../src/background/startup.ts?imported_themes_${"remove_other_restart"}`)) as Startup;
  assert.equal((await restarted.get_config()).settings.theme, "other");
  assert.deepEqual(local[THEME_STORAGE_KEY], mapped(OTHER_SCHEME));
});
