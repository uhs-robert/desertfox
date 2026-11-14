export type ProbeInput = {
  addon: { id: string; temporarilyInstalled?: boolean; version?: string } | undefined;
  loaded_stamp: string | null;
  expected_stamp: string;
};

export type ProbeResult = { ok: true } | { ok: false; message: string };

// The system policy pins a signed beta under the same add-on id, so "the add-on is loaded" proves nothing. Only a temporary install carrying this build's stamp is the worktree's build.
export function judge_probe(input: ProbeInput): ProbeResult {
  if (!input.addon) return { ok: false, message: "WRONG BUILD: the add-on is not loaded in the test window" };
  if (input.addon.temporarilyInstalled !== true) {
    return { ok: false, message: `WRONG BUILD: the policy beta ${input.addon.version ?? "(unknown version)"} is loaded, not this worktree` };
  }
  if (input.loaded_stamp !== input.expected_stamp) {
    return { ok: false, message: `WRONG BUILD: the loaded build says "${input.loaded_stamp ?? "no stamp"}", expected "${input.expected_stamp}"` };
  }
  return { ok: true };
}
