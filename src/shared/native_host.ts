// What the extension and the host install script agree on: names, the permission, and the one-line install command.
// Pure, so the Help page and the background share it.

export const NATIVE_HOST_NAME = "desertfox_host";
export const NATIVE_PERMISSION = "nativeMessaging";

export const REPO = "uhs-robert/desertfox";

// "main" fetches the host from the main branch. A version fetches it from the GitHub release of that version, checked against the signed build.
export type HostChannel = "main" | string;

// `install_type` is `management.getSelf().installType`. A temporary or unpacked add-on has no release of its own, so it follows main.
// Every other build gets the release of its own version. The extension has no beta channel, so the choice is only these two.
export function host_channel(install_type: string, version: string): HostChannel {
  return install_type === "development" ? "main" : version;
}

export const HOST_SCRIPTS = ["desertfox-host", "desertfox-bridge", "desertfox"] as const;
export type HostScript = (typeof HOST_SCRIPTS)[number];

// The SHA-256 of `install.sh` and of each host script, from `host_sha256.json` in the signed build.
export type InstallHashes = { install_sh: string; sha256: Record<HostScript, string> };

const SHA256_HEX = /^[0-9a-f]{64}$/;
// The version goes into the command line, so only x.y.z or x.y.z.N passes.
const COMMAND_SAFE_VERSION = /^\d+(\.\d+){2,3}$/;

// Reads `host_sha256.json`. Anything but a file stamped for this exact version, with a well-formed hash for install.sh
// and each of the three scripts and nothing else, counts as no hashes.
export function install_hashes_of(value: unknown, version: string): InstallHashes | undefined {
  const { version: stamped, sha256, install_sh } = (value ?? {}) as { version?: unknown; sha256?: unknown; install_sh?: unknown };
  if (!COMMAND_SAFE_VERSION.test(version) || stamped !== version || typeof install_sh !== "string" || !SHA256_HEX.test(install_sh)) return undefined;
  if (typeof sha256 !== "object" || sha256 === null || Object.keys(sha256).length !== HOST_SCRIPTS.length) return undefined;
  const digests = sha256 as Record<string, unknown>;
  if (!HOST_SCRIPTS.every((script) => typeof digests[script] === "string" && SHA256_HEX.test(digests[script]))) return undefined;
  return { install_sh, sha256: Object.fromEntries(HOST_SCRIPTS.map((script) => [script, digests[script]])) as Record<HostScript, string> };
}

// Unchecked: the script and the hosts come from the main branch with no checksum.
export function main_install_command(): string {
  return `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/host/install.sh | sh -s -- main`;
}

// Downloads install.sh of the release to a temp file, checks it against the signed build's hash, then runs it with the
// hash of each host script. The whole line runs under `sh -c`, so it works pasted into bash, zsh or fish alike. The
// single-quoted body therefore holds no single quote and no backslash, which fish would unescape.
export function release_install_command(version: string, hashes: InstallHashes): string {
  const script_url = `https://github.com/${REPO}/releases/download/v${version}/install.sh`;
  const host_hashes = HOST_SCRIPTS.map((script) => `--sha256 ${script}=${hashes.sha256[script]}`).join(" ");
  const body = [
    `f=$(mktemp) || exit 1`,
    `clean() { rm -f -- "$f"; }`,
    `trap clean EXIT HUP INT TERM`,
    `curl -fsSL ${script_url} -o "$f" && echo "${hashes.install_sh}  $f" | sha256sum -c && sh "$f" ${version} ${host_hashes}`,
  ].join("; ");
  return `sh -c '${body}'`;
}
