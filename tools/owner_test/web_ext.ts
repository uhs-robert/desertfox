import { join } from "node:path";

export const RELOAD_FILE_NAME = ".owner-test-reload";

// `--keep-profile-changes` stops web-ext from copying the profile: the profile is ours to delete. `--watch-file` narrows reload to one file written after the build ends, so a half-written build never loads. `-no-remote` keeps the window out of the owner's running Firefox.
export function web_ext_args(options: { dist: string; profile: string }): string[] {
  return [
    "run",
    "--source-dir", options.dist,
    "--firefox-profile", options.profile,
    "--keep-profile-changes",
    "--no-input",
    "--watch-file", join(options.dist, RELOAD_FILE_NAME),
    "--args=-no-remote",
    "--start-url", "about:newtab",
  ];
}

// `version_name` carries the build label. `version` stays, so the manifest still installs.
export function stamp_manifest<T extends { version: string }>(manifest: T, label: string): T & { version_name: string } {
  return { ...manifest, version_name: label };
}

// The time makes two builds of the same uncommitted tree differ, so a reload can be told from no reload.
export function stamp_label(branch: string, sha: string, dirty: boolean, built_at: string): string {
  return `owner-test ${branch}@${sha}${dirty ? "+dirty" : ""} ${built_at}`;
}
