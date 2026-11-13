#!/bin/sh
# Installs the DesertFox native-messaging host for Firefox on Linux.
#
#   install.sh <version> --sha256 desertfox-host=<hex> --sha256 desertfox-bridge=<hex> --sha256 desertfox=<hex>
#   install.sh main
#
# The extension shows the one-line command that runs this script. For a release build it passes its own version and
# the SHA-256 of each script from its signed build (host_sha256.json). A version fetches the scripts from the GitHub
# release of that version and refuses any that does not match its given hash, or that has no hash. `main` fetches the
# scripts from the main branch with no checksum, for development builds only. `--channel main` overrides a version and
# ignores the hashes.
# Installs two hosts, the config host and the bridge host, and the `desertfox` command line for the bridge. Writes only
# $XDG_DATA_HOME/desertfox/desertfox-host, desertfox-bridge and desertfox (default ~/.local/share/desertfox),
# ~/.mozilla/native-messaging-hosts/desertfox_host.json and desertfox_bridge.json, the symlink ~/.local/bin/desertfox,
# and the lock file update.lock in the data folder. While it writes, it holds that lock, which the host's self_update takes too, so an install
# and an update never stage the same .new files at once. A second one fails with "update running".
set -eu

repo="uhs-robert/desertfox"
extension_id="desertfox@uhs-robert"

fail() {
    echo "desertfox install: $*" >&2
    exit 1
}

# The whole script is one function called on the last line, so a download cut off mid-way runs nothing.
main() {
    channel_arg=""
    force_main=0
    host_sha256=""
    bridge_sha256=""
    cli_sha256=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --channel)
                [ $# -ge 2 ] || fail "--channel needs a value (main)"
                [ "$2" = "main" ] || fail "unknown channel '$2' (only main)"
                force_main=1
                shift 2
                ;;
            --sha256)
                [ $# -ge 2 ] || fail "--sha256 needs a value (<script>=<hex>)"
                take_hash "$2"
                shift 2
                ;;
            -*) fail "unknown option '$1'" ;;
            *)
                [ -z "$channel_arg" ] || fail "more than one version given"
                channel_arg="$1"
                shift
                ;;
        esac
    done
    [ -n "$channel_arg" ] || fail "usage: install.sh <version> --sha256 <script>=<hex> (one per script), or install.sh main"
    [ "$force_main" -eq 1 ] && channel_arg="main"
    case "$channel_arg" in
        main) ;;
        *[!0-9A-Za-z.+-]* | "") fail "'$channel_arg' is not a version or main" ;;
        [0-9]*.[0-9]*.[0-9]*) ;;
        *) fail "'$channel_arg' is not a version or main" ;;
    esac
    if [ "$channel_arg" = "main" ]; then
        echo "WARNING: installing the host from the main branch with no checksum. Use this for development builds only." >&2
    else
        for script in desertfox-host desertfox-bridge desertfox; do
            [ -n "$(expected_hash "$script")" ] || fail "no hash given for $script. Pass --sha256 $script=<hex>, as the command on the DesertFox page does. Nothing was installed."
        done
    fi

    command -v python3 >/dev/null 2>&1 || fail "python3 3.9 or newer is required, and none was found. Install it, then run this again."
    python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' ||
        fail "python3 3.9 or newer is required, found $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')."
    command -v curl >/dev/null 2>&1 || fail "curl is required."

    [ -n "${HOME:-}" ] || fail "HOME is not set."
    # A relative XDG_DATA_HOME is invalid by the XDG spec and ignored.
    case "${XDG_DATA_HOME:-}" in
        /*) data_home="$XDG_DATA_HOME" ;;
        *) data_home="$HOME/.local/share" ;;
    esac
    data_dir="$data_home/desertfox"
    manifest_dir="$HOME/.mozilla/native-messaging-hosts"

    work_dir=$(mktemp -d)
    trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

    # Every script is fetched and checked before any is written, so a bad download installs nothing.
    if [ "$channel_arg" = "main" ]; then
        base_url="https://raw.githubusercontent.com/$repo/main/host"
    else
        base_url="https://github.com/$repo/releases/download/v$channel_arg"
    fi
    for script in desertfox-host desertfox-bridge desertfox; do
        fetch_host "$script"
    done
    if [ "$channel_arg" = "main" ]; then
        echo "Fetched the scripts from the main branch. No checksum applies."
    else
        echo "Checksums verified for version $channel_arg against the hashes the extension gave."
    fi

    mkdir -p "$data_dir" "$manifest_dir"
    take_update_lock
    install_host desertfox-host desertfox_host "DesertFox config files and saved edits"
    install_host desertfox-bridge desertfox_bridge "DesertFox bridge to a desktop shell"
    install_cli
    echo "Return to Firefox and press the permission button on the DesertFox page."
}

# Holds the lock on file descriptor 9 until this script exits, so the lock spans the staging and the renames. The file
# sits in the data folder, which the host updater also writes, so both compute the same path.
take_update_lock() {
    command -v flock >/dev/null 2>&1 || fail "flock (util-linux) is required."
    lock_path="$data_dir/update.lock"
    exec 9>>"$lock_path"
    flock -n 9 || fail "update running: a DesertFox host is updating now. Run this again in a minute."
}

# Records one `--sha256 <script>=<hex>`. A hash for an unknown script, a second hash for one script or a value that is
# not 64 hex digits is refused, so a typo never leaves a script unchecked.
take_hash() {
    hash_name="${1%%=*}"
    hash_value="${1#*=}"
    [ "$hash_name" != "$1" ] || fail "--sha256 takes <script>=<hex>, got '$1'"
    case "$hash_value" in
        *[!0-9a-f]*) fail "the hash for $hash_name must be 64 lowercase hex digits" ;;
    esac
    [ "${#hash_value}" -eq 64 ] || fail "the hash for $hash_name must be 64 lowercase hex digits"
    [ -z "$(expected_hash "$hash_name")" ] || fail "more than one hash given for $hash_name"
    case "$hash_name" in
        desertfox-host) host_sha256="$hash_value" ;;
        desertfox-bridge) bridge_sha256="$hash_value" ;;
        desertfox) cli_sha256="$hash_value" ;;
        *) fail "unknown script '$hash_name' in --sha256 (desertfox-host, desertfox-bridge or desertfox)" ;;
    esac
}

expected_hash() {
    case "$1" in
        desertfox-host) echo "$host_sha256" ;;
        desertfox-bridge) echo "$bridge_sha256" ;;
        desertfox) echo "$cli_sha256" ;;
    esac
}

# Downloads one host script into $work_dir. A release refuses a script whose SHA-256 differs from the hash on the
# command line. The release's own .sha256 files are not read: they come from the same place as the scripts.
fetch_host() {
    script="$1"
    curl -fsSL "$base_url/$script" -o "$work_dir/$script" || fail "could not download the host from $base_url/$script"
    if [ "$channel_arg" != "main" ]; then
        expected=$(expected_hash "$script")
        actual=$(python3 -I -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$work_dir/$script")
        if [ "$expected" != "$actual" ]; then
            fail "checksum mismatch for $script of version $channel_arg (expected $expected, got $actual). Nothing was installed."
        fi
    fi
    head -n 1 "$work_dir/$script" | grep -q '^#!.*python3' || fail "the downloaded $script is not a host script. Nothing was installed."
}

# Writes one fetched host and its native-messaging manifest.
install_host() {
    script="$1"
    name="$2"
    description="$3"
    host_path="$data_dir/$script"
    manifest_path="$manifest_dir/$name.json"
    cp "$work_dir/$script" "$host_path.new"
    chmod 755 "$host_path.new"
    mv -f "$host_path.new" "$host_path"
    python3 -I -c '
import json, sys
manifest = {
    "name": sys.argv[1],
    "description": sys.argv[4],
    "path": sys.argv[2],
    "type": "stdio",
    "allowed_extensions": [sys.argv[3]],
}
print(json.dumps(manifest, indent=2))
    ' "$name" "$host_path" "$extension_id" "$description" >"$manifest_path.new"
    mv -f "$manifest_path.new" "$manifest_path"
    echo "Installed the host at $host_path"
    echo "Installed the manifest at $manifest_path"
}

# Writes the command line next to the hosts and links it into ~/.local/bin. A file that is not a link already sits at the
# link path, so it is left alone and the user is told.
install_cli() {
    cli_path="$data_dir/desertfox"
    cp "$work_dir/desertfox" "$cli_path.new"
    chmod 755 "$cli_path.new"
    mv -f "$cli_path.new" "$cli_path"
    echo "Installed the command line at $cli_path"
    link_dir="$HOME/.local/bin"
    link_path="$link_dir/desertfox"
    if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
        echo "Left $link_path alone, because it is not a link. Run $cli_path instead."
        return
    fi
    mkdir -p "$link_dir"
    ln -sfn "$cli_path" "$link_path"
    echo "Linked $link_path to it"
}

main "$@"
