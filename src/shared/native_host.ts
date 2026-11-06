// What the extension and the host install script agree on: names, the permission, and the one-line install command.
// Pure, so the Help page and the background share it.

export const NATIVE_HOST_NAME = "desertfox_host";
export const NATIVE_PERMISSION = "nativeMessaging";

// The hash `:native.install` opens on the Help page. Help's router shows Home for it, and the install panel reads it.
export const NATIVE_INSTALL_HASH = "#native-install";

// Each `:native.install` adds a fresh suffix, so a tab already on the page sees a hash change and shows the panel again.
export const native_install_hash = (nonce: number): string => `${NATIVE_INSTALL_HASH}?${nonce}`;
export const is_native_install_hash = (hash: string): boolean => hash === NATIVE_INSTALL_HASH || hash.startsWith(`${NATIVE_INSTALL_HASH}?`);

const REPO = "uhs-robert/desertfox";

// "main" fetches the host from the main branch. A version fetches it from the GitHub release of that version, checked by checksum.
export type HostChannel = "main" | string;

// `install_type` is `management.getSelf().installType`. A temporary or unpacked add-on has no release of its own, so it follows main.
// Every other build gets the release of its own version. The extension has no beta channel, so the choice is only these two.
export function host_channel(install_type: string, version: string): HostChannel {
  return install_type === "development" ? "main" : version;
}

// The install script comes from the same place as the host, so a release build never runs a script newer than itself.
export function install_command(channel: HostChannel): string {
  const script_url =
    channel === "main"
      ? `https://raw.githubusercontent.com/${REPO}/main/host/install.sh`
      : `https://github.com/${REPO}/releases/download/v${channel}/install.sh`;
  return `curl -fsSL ${script_url} | sh -s -- ${channel}`;
}
