#!/usr/bin/env bash
# Runs inside the nested session. Usage: launch_firefox.sh <run_dir> <profile_dir> <debug_port> <managed_json>
# The managed storage file goes under this session's HOME before Firefox starts, because Firefox reads it at load.
set -euo pipefail
run_dir=$1 profile_dir=$2 debug_port=$3 managed_json=$4
mkdir -p "$HOME/.mozilla/managed-storage"
cp "$managed_json" "$HOME/.mozilla/managed-storage/"
echo "$HOME" > "$run_dir/session_home"
# The native host reads the config through this link, so a case can point it at another folder.
export DESERTFOX_CONFIG_DIR="$run_dir/active_config"
exec firefox -no-remote -profile "$profile_dir" -start-debugger-server "$debug_port" about:blank
