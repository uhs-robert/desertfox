// The private Firefox copy every key-test run uses, made once per run in the run folder. launch_firefox.sh starts it through KEY_TEST_FIREFOX.
// It is /usr/lib/firefox with the test loader (chrome_loader.cfg) in place of any AutoConfig file, and a chrome.d that holds the worktree's browser module and a drop-in that throws at load.
// So a run never loads a browser module installed on the machine, and the whole suite runs with this worktree's module present and its pref off.
import { chmodSync, copyFileSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
const module_dir = resolve(key_test_dir, "../../browser_module");
export const SYSTEM_FIREFOX_DIR = "/usr/lib/firefox";
// browser_module/install.sh installs the same pattern.
export const MODULE_FILE_PATTERN = /^desertfox-[a-z0-9-]+\.js$/;
const THROWS_FILE = "00-key-test-throws.js";

const AUTOCONFIG = 'pref("general.config.filename", "mozilla.cfg");\npref("general.config.obscure_value", 0);\npref("general.config.sandbox_enabled", false);\n';

export const module_files = (dir = module_dir) => readdirSync(dir).filter((name) => MODULE_FILE_PATTERN.test(name)).sort();

// Returns the path of the copy's firefox binary. Firefox finds its install dir (GreD) from the real path of the binary, so the copy is a real copy, not links.
export function make_firefox_copy(run_dir, { source_dir = SYSTEM_FIREFOX_DIR, modules_from = module_dir } = {}) {
  const copy_dir = join(run_dir, "firefox");
  cpSync(source_dir, copy_dir, { recursive: true });
  rmSync(join(copy_dir, "mozilla.cfg"), { force: true });
  rmSync(join(copy_dir, "chrome.d"), { recursive: true, force: true });
  copyFileSync(join(key_test_dir, "chrome_loader.cfg"), join(copy_dir, "mozilla.cfg"));
  const pref_dir = join(copy_dir, "defaults", "pref");
  mkdirSync(pref_dir, { recursive: true });
  writeFileSync(join(pref_dir, "autoconfig.js"), AUTOCONFIG);
  const drop_in_dir = join(copy_dir, "chrome.d");
  mkdirSync(drop_in_dir, { mode: 0o755 });
  chmodSync(drop_in_dir, 0o755);
  copyFileSync(join(key_test_dir, "chrome_throws.js"), join(drop_in_dir, THROWS_FILE));
  for (const name of module_files(modules_from)) copyFileSync(join(modules_from, name), join(drop_in_dir, name));
  for (const name of readdirSync(drop_in_dir)) chmodSync(join(drop_in_dir, name), 0o644);
  return join(copy_dir, "firefox");
}
