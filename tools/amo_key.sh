# Sourced by the recipes that sign (`release`, `sign_listed`). Defines load_amo_key.
# It fills the shell variables amo_key and amo_secret from the AMO key and never exports them, so only the command that signs gets them. A key already in those variables stays. Otherwise one in WEB_EXT_API_KEY and WEB_EXT_API_SECRET moves into them and leaves the environment (a recipe that runs other commands first does this itself at its top). With none set, it reads the rbw entry $AMO_RBW_ENTRY: the issuer is the first `user:N:N` in the notes, the secret is the password.

load_amo_key() {
    amo_key="${amo_key:-${WEB_EXT_API_KEY:-}}"
    amo_secret="${amo_secret:-${WEB_EXT_API_SECRET:-}}"
    unset WEB_EXT_API_KEY WEB_EXT_API_SECRET
    if [ -n "$amo_key" ] && [ -n "$amo_secret" ]; then
        return 0
    fi
    local tool entry_json
    for tool in rbw jq; do
        command -v "$tool" >/dev/null || { echo "signing needs $tool to read the AMO key from rbw. Install it, or set WEB_EXT_API_KEY and WEB_EXT_API_SECRET." >&2; return 1; }
    done
    rbw unlocked >/dev/null 2>&1 || { echo "signing needs an unlocked rbw vault. Run 'rbw unlock', then retry." >&2; return 1; }
    entry_json=$(rbw get --raw "$AMO_RBW_ENTRY") || { echo "signing could not read the rbw entry '$AMO_RBW_ENTRY'." >&2; return 1; }
    amo_key=$(jq -r '.notes // ""' <<<"$entry_json" | grep -o -m1 'user:[0-9]*:[0-9]*' || true)
    if [ -z "$amo_key" ]; then
        echo "The notes of rbw entry '$AMO_RBW_ENTRY' hold no issuer (user:N:N)." >&2
        return 1
    fi
    amo_secret=$(jq -r '.data.password // ""' <<<"$entry_json")
    if [ -z "$amo_secret" ]; then
        echo "The password of rbw entry '$AMO_RBW_ENTRY' is empty." >&2
        return 1
    fi
}
