#!/usr/bin/env bash
# Drive the spike Firefox in a nested Hyprland with real key presses. Source it, then call the helpers.
# SHADOW_SH is a script that runs `<script> keys <name> <wtype args...>` in the nested session.
: "${SHADOW_SH:?set SHADOW_SH to the nested-session driver script}"
spike_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
k() { "$SHADOW_SH" keys ffspike "$@"; }
mark() { printf '{"kind":"mark","label":"%s","host_s":%s}\n' "$1" "$(date +%s.%N)" >> "$spike_dir/results/log.jsonl"; }
nav() { k -M ctrl l -m ctrl; sleep 0.3; k "$1"; k -k Return; }
newtab() { k -M ctrl t -m ctrl; sleep 0.5; }
shiftj() { k J; }
altj() { k -M alt j -m alt; }
