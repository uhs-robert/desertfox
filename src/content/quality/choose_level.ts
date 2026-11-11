// The policy of `media quality`: which of a player's levels a value picks. The drivers hold no policy.

export type Choice = { height: number };

// `levels` run from the lowest to the highest. `current` is the index of the playing level, if the player says. A value the schema accepts always lands here, so the last branch is a height.
// A height picks the highest level at or below it, else the lowest. `up` and `down` move `times` levels from the current one, which reads as the top when the player does not say, and stop at the ends. `auto` is not a level: the caller hands the choice back to the site.
export function choose_level<Level extends Choice>(levels: readonly Level[], value: string, current: number | undefined, times: number): Level | undefined {
  if (levels.length === 0) return undefined;
  const top = levels.length - 1;
  if (value === "max") return levels[top];
  if (value === "min") return levels[0];
  if (value === "up" || value === "down") return levels[Math.min(top, Math.max(0, (current ?? top) + (value === "up" ? times : -times)))];
  const wanted = parseInt(value, 10);
  return levels.findLast((level) => level.height <= wanted) ?? levels[0];
}
