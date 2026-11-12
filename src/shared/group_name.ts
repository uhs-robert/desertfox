// Names for native tab groups. Firefox allows empty and repeated titles, so a title alone cannot always pick one group.
// A label is the title when no other group in the list shares it, else the title with the group id as a suffix (`#12`).

export type NamedGroup = { id: number; title: string };

export type GroupMatch = { kind: "found"; id: number } | { kind: "none" } | { kind: "ambiguous"; ids: number[] };

export function group_labels(groups: readonly NamedGroup[]): Map<number, string> {
  const uses = new Map<string, number>();
  for (const group of groups) uses.set(group.title.trim(), (uses.get(group.title.trim()) ?? 0) + 1);
  return new Map(groups.map((group) => {
    const title = group.title.trim();
    return [group.id, title !== "" && uses.get(title) === 1 ? title : `${title} #${group.id}`.trim()];
  }));
}

// A typed label picks its group. A bare title picks the group only when one group has it.
export function find_group(groups: readonly NamedGroup[], typed: string): GroupMatch {
  const text = typed.trim();
  if (text === "") return { kind: "none" };
  const by_label = [...group_labels(groups)].find(([, label]) => label === text);
  if (by_label) return { kind: "found", id: by_label[0] };
  const by_title = groups.filter((group) => group.title.trim() === text);
  if (by_title.length === 1) return { kind: "found", id: by_title[0]!.id };
  return by_title.length > 1 ? { kind: "ambiguous", ids: by_title.map((group) => group.id) } : { kind: "none" };
}
