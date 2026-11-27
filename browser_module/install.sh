#!/usr/bin/env bash
# Installs the DesertFox browser module into Firefox's drop-in folder, or removes it with --uninstall. Run it with sudo.
# Usage: sudo browser_module/install.sh [--uninstall]
# DESERTFOX_FIREFOX_DIR names the Firefox install folder when it is not /usr/lib/firefox.
# A loader that reads the folder must already be in place (see docs/design/browser_module.md). This script makes no loader, never touches mozilla.cfg and never creates the folder.
set -euo pipefail

firefox_dir=${DESERTFOX_FIREFOX_DIR:-/usr/lib/firefox}
drop_in_dir="$firefox_dir/chrome.d"
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Every module file, the core and each feature. test/key/firefox_copy.mjs installs the same set.
module_name='^desertfox-[a-z0-9-]+\.js$'

die() {
  echo "browser module install: $*" >&2
  exit 1
}

mode=install
case "${1:-}" in
  "") ;;
  --uninstall) mode=uninstall ;;
  *) die "unknown argument $1 (usage: install.sh [--uninstall])" ;;
esac
[ "$#" -le 1 ] || die "too many arguments (usage: install.sh [--uninstall])"

[ "$(id -u)" -eq 0 ] || die "run it with sudo: the drop-in folder belongs to root"
# The loader skips a folder anyone else can write, so this script refuses one too.
[ -e "$drop_in_dir" ] || die "$drop_in_dir is missing. Install a loader for it first."
[ ! -L "$drop_in_dir" ] && [ -d "$drop_in_dir" ] || die "$drop_in_dir is not a real folder"
[ "$(stat -c %u "$drop_in_dir")" -eq 0 ] || die "$drop_in_dir is not owned by root"
(( ($(stat -c %#a "$drop_in_dir") & 8#022) == 0 )) || die "$drop_in_dir can be written by group or others"

installed_names() {
  find "$drop_in_dir" -maxdepth 1 -type f -printf '%f\n' | grep -E "$module_name" || true
}

if [ "$mode" = uninstall ]; then
  while IFS= read -r name; do
    [ -n "$name" ] && rm -f -- "$drop_in_dir/$name"
  done < <(installed_names)
  echo "browser module removed from $drop_in_dir. Restart Firefox."
  exit 0
fi

mapfile -t wanted < <(find "$source_dir" -maxdepth 1 -type f -printf '%f\n' | grep -E "$module_name" | sort)
[ "${#wanted[@]}" -gt 0 ] || die "no module files in $source_dir"

# Each file lands under a name the loader skips, then moves in place, so a window that opens meanwhile never loads half a file.
for name in "${wanted[@]}"; do
  install -m 0644 -o root -g root -- "$source_dir/$name" "$drop_in_dir/.$name.part"
  mv -f -- "$drop_in_dir/.$name.part" "$drop_in_dir/$name"
done
# A feature file that a newer checkout renamed or dropped goes too.
while IFS= read -r name; do
  [ -n "$name" ] || continue
  printf '%s\n' "${wanted[@]}" | grep -qxF -- "$name" || rm -f -- "$drop_in_dir/$name"
done < <(installed_names)
echo "browser module installed in $drop_in_dir: ${wanted[*]}. Set desertfox.browser_module.enabled to true in about:config, turn on the setting browser_module in DesertFox, then restart Firefox."
