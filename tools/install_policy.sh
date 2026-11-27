#!/usr/bin/env bash
# Pin DesertFox through Firefox's policy file (/etc/firefox/policies/policies.json). Needs sudo and jq.
#
# Usage: install_policy.sh [--dry-run] [stable | beta [xpi_url]]
#   stable (default, what `just install` runs): copies the one signed xpi in web-ext-artifacts/ (`just sign`) to /usr/local/share/desertfox and pins a file:// URL to it.
#   beta: pins the https URL of desertfox-beta.xpi on the beta-channel release, an asset the beta workflow replaces on each build and the prune never deletes. It copies no local xpi. xpi_url overrides the URL. Without that asset (before the first beta build publishes it) it falls back to the update_link in updates.json.
#   --dry-run: prints the merged policy and writes nothing, and runs no sudo.
# Run `stable` to go back from beta. DESERTFOX_POLICIES_FILE overrides the policy path that is read, for tests.
# Both modes keep every other policy entry, and block the id before the rename.
set -euo pipefail

extension_id="desertfox@uhs-robert"
# The id before the rename, split so the rename check does not count it. Blocking it makes Firefox remove the old add-on, where a deleted entry would leave it installed.
previous_extension_id="oasis""fox@uhs-robert"
shared_dir="/usr/local/share/desertfox"
policies_file="${DESERTFOX_POLICIES_FILE:-/etc/firefox/policies/policies.json}"
distribution_file="/usr/lib/firefox/distribution/policies.json"
beta_default_xpi_url="https://github.com/uhs-robert/desertfox/releases/download/beta-channel/desertfox-beta.xpi"
beta_updates_url="https://github.com/uhs-robert/desertfox/releases/download/beta-channel/updates.json"

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
    dry_run=1
    shift
fi
mode="${1:-stable}"
beta_xpi_url="${2:-}"
case "$mode" in
    stable | beta) ;;
    *) echo "usage: install_policy.sh [--dry-run] [stable | beta [xpi_url]]" >&2; exit 1 ;;
esac
command -v jq >/dev/null || { echo "install needs jq." >&2; exit 1; }

# Firefox merges policy files poorly, so a second file would hide this one or the other way round.
if [ -e "$distribution_file" ]; then
    echo "$distribution_file exists. Merge the DesertFox entry into it by hand and drop $policies_file." >&2
    exit 1
fi

if [ "$mode" = "beta" ]; then
    # The fixed asset exists only after a beta build has published it. Until then pin the versioned URL from updates.json.
    if [ -z "$beta_xpi_url" ]; then
        if curl -sfIL -o /dev/null "$beta_default_xpi_url"; then
            beta_xpi_url="$beta_default_xpi_url"
        else
            echo "$beta_default_xpi_url does not exist yet, so the pin uses the xpi URL from updates.json." >&2
            beta_xpi_url=$(curl -fsSL "$beta_updates_url" | jq -r --arg id "$extension_id" '.addons[$id].updates[0].update_link')
        fi
    fi
    case "$beta_xpi_url" in
        https://*) ;;
        *) echo "beta needs an https xpi URL, got '$beta_xpi_url'." >&2; exit 1 ;;
    esac
    install_url="$beta_xpi_url"
else
    shopt -s nullglob
    xpis=(web-ext-artifacts/*.xpi)
    if [ "${#xpis[@]}" -ne 1 ]; then
        echo "install needs exactly one signed xpi in web-ext-artifacts/. Run 'just sign' first." >&2
        exit 1
    fi
    installed_xpi="$shared_dir/$extension_id.xpi"
    install_url="file://$installed_xpi"
fi

current_policies='{"policies":{}}'
if [ -f "$policies_file" ]; then
    current_policies=$(cat "$policies_file")
fi
merged_policies=$(jq --arg id "$extension_id" --arg previous_id "$previous_extension_id" --arg url "$install_url" \
    '.policies.ExtensionSettings[$previous_id] = {installation_mode: "blocked"} | .policies.ExtensionSettings[$id] = {installation_mode: "normal_installed", install_url: $url}' \
    <<<"$current_policies")

if [ "$dry_run" = 1 ]; then
    printf '%s\n' "$merged_policies"
    exit 0
fi

if [ "$mode" = "stable" ]; then
    sudo install -D -m 0644 "${xpis[0]}" "$installed_xpi"
fi

# Write beside the target, then rename, so Firefox never reads a half-written file.
sudo mkdir -p "$(dirname "$policies_file")"
temp_file=$(sudo mktemp "$policies_file.XXXXXX")
printf '%s\n' "$merged_policies" | sudo tee "$temp_file" >/dev/null
sudo chmod 0644 "$temp_file"
sudo mv "$temp_file" "$policies_file"
echo "installed $extension_id ($mode) through $policies_file. Restart Firefox."
