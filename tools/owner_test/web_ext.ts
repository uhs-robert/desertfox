// `--keep-profile-changes` stops web-ext from copying the profile: the profile is ours to delete. `--no-reload` turns off web-ext's own watcher, which fires many times per build and can load a half-written build. The script reloads over the debugger after the build ends instead. `-no-remote` keeps the window out of the maintainer's running Firefox.
export function web_ext_args(options: { dist: string; profile: string }): string[] {
  return [
    "run",
    "--source-dir", options.dist,
    "--firefox-profile", options.profile,
    "--keep-profile-changes",
    "--no-input",
    "--no-reload",
    // web-ext writes startup.page=0 and a blank home page after reading user.js, and only a --pref comes after that.
    "--pref=browser.startup.page=1",
    "--pref=browser.startup.homepage=about:home",
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

export function tail_lines(text: string, count: number): string {
  return text.trimEnd().split("\n").slice(-count).join("\n");
}
