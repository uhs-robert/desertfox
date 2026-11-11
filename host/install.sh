#!/bin/sh
# Installs the DesertFox native-messaging host for Firefox on Linux.
#
#   install.sh <version|main> [--channel main]
#
# The extension passes its own version in the one-line command it shows. A version fetches the host from the GitHub
# release of that version and checks its SHA-256. `main` fetches the host from the main branch with no checksum,
# for beta and development builds. `--channel main` overrides a version.
# Installs two hosts, the config host and the bridge host. Writes only $XDG_DATA_HOME/desertfox/desertfox-host and
# desertfox-bridge (default ~/.local/share/desertfox) and ~/.mozilla/native-messaging-hosts/desertfox_host.json and
# desertfox_bridge.json.
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
    while [ $# -gt 0 ]; do
        case "$1" in
            --channel)
                [ $# -ge 2 ] || fail "--channel needs a value (main)"
                [ "$2" = "main" ] || fail "unknown channel '$2' (only main)"
                force_main=1
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
    [ -n "$channel_arg" ] || fail "usage: install.sh <version|main> [--channel main]"
    [ "$force_main" -eq 1 ] && channel_arg="main"
    case "$channel_arg" in
        main) ;;
        *[!0-9A-Za-z.+-]* | "") fail "'$channel_arg' is not a version or main" ;;
        [0-9]*.[0-9]*.[0-9]*) ;;
        *) fail "'$channel_arg' is not a version or main" ;;
    esac

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

    # Both hosts are fetched and checked before either is written, so a bad download installs nothing.
    if [ "$channel_arg" = "main" ]; then
        base_url="https://raw.githubusercontent.com/$repo/main/host"
    else
        base_url="https://github.com/$repo/releases/download/v$channel_arg"
    fi
    for script in desertfox-host desertfox-bridge; do
        fetch_host "$script"
    done
    if [ "$channel_arg" = "main" ]; then
        echo "Fetched the hosts from the main branch. No checksum applies."
    else
        echo "Checksums verified for version $channel_arg."
    fi

    mkdir -p "$data_dir" "$manifest_dir"
    install_host desertfox-host desertfox_host "DesertFox config files and saved edits"
    install_host desertfox-bridge desertfox_bridge "DesertFox bridge to a desktop shell"
    echo "Return to Firefox and press the permission button on the DesertFox page."
}

# Downloads one host script into $work_dir. A release also fetches its checksum and refuses a mismatch.
fetch_host() {
    script="$1"
    curl -fsSL "$base_url/$script" -o "$work_dir/$script" || fail "could not download the host from $base_url/$script"
    if [ "$channel_arg" != "main" ]; then
        curl -fsSL "$base_url/$script.sha256" -o "$work_dir/$script.sha256" || fail "could not download the checksum from $base_url/$script.sha256"
        expected=$(python3 -I -c 'import sys; print(open(sys.argv[1]).read().split()[0].lower())' "$work_dir/$script.sha256" 2>/dev/null) ||
            fail "the checksum file is empty or unreadable. Nothing was installed."
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

main "$@"
