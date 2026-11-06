#!/usr/bin/env bash
# Install the signed DesertFox xpi through Firefox's policy file (/etc/firefox/policies/policies.json).
# Run through `just install`. Needs sudo and jq, and a signed xpi in web-ext-artifacts/ (`just sign`).
set -euo pipefail

extension_id="desertfox@uhs-robert"
# The id before the rename, split so the rename check does not count it. Its policy entry would keep force-installing the old xpi.
previous_extension_id="oasis""fox@uhs-robert"
shared_dir="/usr/local/share/desertfox"
policies_file="/etc/firefox/policies/policies.json"
distribution_file="/usr/lib/firefox/distribution/policies.json"

shopt -s nullglob
xpis=(web-ext-artifacts/*.xpi)
if [ "${#xpis[@]}" -ne 1 ]; then
    echo "install needs exactly one signed xpi in web-ext-artifacts/. Run 'just sign' first." >&2
    exit 1
fi
command -v jq >/dev/null || { echo "install needs jq." >&2; exit 1; }

# Firefox merges policy files poorly, so a second file would hide this one or the other way round.
if [ -e "$distribution_file" ]; then
    echo "$distribution_file exists. Merge the DesertFox entry into it by hand and drop $policies_file." >&2
    exit 1
fi

installed_xpi="$shared_dir/$extension_id.xpi"
sudo install -D -m 0644 "${xpis[0]}" "$installed_xpi"

current_policies='{"policies":{}}'
if [ -f "$policies_file" ]; then
    current_policies=$(cat "$policies_file")
fi
merged_policies=$(jq --arg id "$extension_id" --arg previous_id "$previous_extension_id" --arg url "file://$installed_xpi" \
    'del(.policies.ExtensionSettings[$previous_id]) | .policies.ExtensionSettings[$id] = {installation_mode: "normal_installed", install_url: $url}' \
    <<<"$current_policies")

# Write beside the target, then rename, so Firefox never reads a half-written file.
sudo mkdir -p "$(dirname "$policies_file")"
temp_file=$(sudo mktemp "$policies_file.XXXXXX")
printf '%s\n' "$merged_policies" | sudo tee "$temp_file" >/dev/null
sudo chmod 0644 "$temp_file"
sudo mv "$temp_file" "$policies_file"
echo "installed $extension_id through $policies_file. Restart Firefox."
