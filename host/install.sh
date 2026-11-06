#!/bin/sh
# Installs the DesertFox native-messaging host for Firefox on Linux.
#
#   install.sh <version|main> [--channel main]
#
# The extension passes its own version in the one-line command it shows. A version fetches the host from the GitHub
# release of that version and checks its SHA-256. `main` fetches the host from the main branch with no checksum,
# for beta and development builds. `--channel main` overrides a version.
# Writes only $XDG_DATA_HOME/desertfox/desertfox-host (default ~/.local/share/desertfox) and
# ~/.mozilla/native-messaging-hosts/desertfox_host.json.
set -eu

repo="uhs-robert/desertfox"
host_name="desertfox_host"
extension_id="desertfox@uhs-robert"

fail() {
    echo "desertfox install: $*" >&2
    exit 1
}

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
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/desertfox"
host_path="$data_dir/desertfox-host"
manifest_dir="$HOME/.mozilla/native-messaging-hosts"
manifest_path="$manifest_dir/$host_name.json"

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

if [ "$channel_arg" = "main" ]; then
    base_url="https://raw.githubusercontent.com/$repo/main/host"
    curl -fsSL "$base_url/desertfox-host" -o "$work_dir/desertfox-host" || fail "could not download the host from $base_url/desertfox-host"
    echo "Fetched the host from the main branch. No checksum applies."
else
    base_url="https://github.com/$repo/releases/download/v$channel_arg"
    curl -fsSL "$base_url/desertfox-host" -o "$work_dir/desertfox-host" || fail "could not download the host from $base_url/desertfox-host"
    curl -fsSL "$base_url/desertfox-host.sha256" -o "$work_dir/desertfox-host.sha256" || fail "could not download the checksum from $base_url/desertfox-host.sha256"
    expected=$(python3 -I -c 'import sys; print(open(sys.argv[1]).read().split()[0].lower())' "$work_dir/desertfox-host.sha256" 2>/dev/null) ||
        fail "the checksum file is empty or unreadable. Nothing was installed."
    actual=$(python3 -I -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$work_dir/desertfox-host")
    if [ "$expected" != "$actual" ]; then
        fail "checksum mismatch for the host of version $channel_arg (expected $expected, got $actual). Nothing was installed."
    fi
    echo "Checksum verified for version $channel_arg."
fi

head -n 1 "$work_dir/desertfox-host" | grep -q '^#!.*python3' || fail "the downloaded file is not the host script. Nothing was installed."

mkdir -p "$data_dir" "$manifest_dir"
cp "$work_dir/desertfox-host" "$host_path.new"
chmod 755 "$host_path.new"
mv -f "$host_path.new" "$host_path"

python3 -I -c '
import json, sys
manifest = {
    "name": sys.argv[1],
    "description": "DesertFox config files and saved edits",
    "path": sys.argv[2],
    "type": "stdio",
    "allowed_extensions": [sys.argv[3]],
}
print(json.dumps(manifest, indent=2))
' "$host_name" "$host_path" "$extension_id" >"$manifest_path.new"
mv -f "$manifest_path.new" "$manifest_path"

echo "Installed the host at $host_path"
echo "Installed the manifest at $manifest_path"
echo "Return to Firefox and press the permission button on the DesertFox page."
