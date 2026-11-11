// Release versions of the extension and the native hosts, and the one question the updater asks: is this host older than the extension?
// Pure, so the background and the tests share it. The same pattern guards `self_update` in `host/desertfox-host`.

// [0-9], not \d, and the length cap, match VERSION_PATTERN in the host, which refuses any other version.
const RELEASE_VERSION_PATTERN = /^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})(?:\.([1-9][0-9]{0,5}))?$/;

export type ReleaseVersion = { major: number; minor: number; patch: number; beta: number | undefined };

// "1.2.3" is a stable release. "1.2.3.4" is the fourth beta after 1.2.3 (AMO refuses letters in a version), numbered from 1. Anything else, including the `dev` placeholder of a repo checkout, is undefined.
export function parse_release_version(text: unknown): ReleaseVersion | undefined {
  if (typeof text !== "string") return undefined;
  const match = RELEASE_VERSION_PATTERN.exec(text);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), beta: match[4] === undefined ? undefined : Number(match[4]) };
}

// Negative when `a` is older. A beta counts up from the release before it, so 1.2.3 is older than 1.2.3.1 and 1.2.3.9 is older than 1.2.4.
export function compare_release_versions(a: ReleaseVersion, b: ReleaseVersion): number {
  const numeric = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (numeric !== 0) return numeric;
  return (a.beta ?? 0) - (b.beta ?? 0);
}

export type UpdateChannel = "stable" | "beta" | "development";

// `install_type` is `management.getSelf().installType`. A temporary or unpacked add-on follows main and never updates its host.
export function update_channel(install_type: string, extension_version: string): UpdateChannel {
  if (install_type === "development") return "development";
  return parse_release_version(extension_version)?.beta === undefined ? "stable" : "beta";
}

// "outdated": the host is older than the extension, or sent no version at all, which is how a host from before the updater reads.
// "development": the repo placeholder, which the host itself refuses to update.
// "current": equal or newer. A newer host stays, so two profiles never downgrade each other.
export type HostStanding = "outdated" | "current" | "development";

export function host_standing(host_release_version: unknown, extension_version: string): HostStanding {
  if (host_release_version === "dev") return "development";
  const extension = parse_release_version(extension_version);
  // An extension build with no release version has nothing to match a host to.
  if (!extension) return "current";
  const host = parse_release_version(host_release_version);
  return host === undefined || compare_release_versions(host, extension) < 0 ? "outdated" : "current";
}
