import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

// Every test that needs a scratch directory makes it here, so the directory is removed even when the test body throws. `just test` fails the run if a directory is left behind.
const live_dirs = new Set<string>();

function remove_dir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  live_dirs.delete(dir);
}

// Fixture factories and module-level fixtures have no test context, so every directory is also removed when the test file's process exits. Pass `t` to remove it as soon as the test ends.
process.on("exit", () => live_dirs.forEach(remove_dir));

export function make_tmp_dir(prefix: string, t?: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  live_dirs.add(dir);
  t?.after(() => remove_dir(dir));
  return dir;
}
