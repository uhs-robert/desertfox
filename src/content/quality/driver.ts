// What a site player driver offers the bundle. A driver reads the page handle each time it is asked and keeps nothing, so a player that the site replaced (YouTube navigates in place) is found again.

import type { Choice } from "./choose_level.ts";

// `pick` switches the player to this level now.
export type PlayerLevel = Choice & { label: string; active: boolean; pick: () => void };

export type Driver = {
  // Ascending by height. Empty while the player does not know its levels yet.
  levels: () => PlayerLevel[];
  // Hands the choice back to the site. False when the player could not take it yet.
  auto: () => boolean;
  // Whether the player took the skip.
  skip: (forward: boolean) => boolean;
};

// A real player lists a dozen levels. The page owns `length`, so a hostile one cannot make the loop long.
const MAX_LEVELS = 64;

// The page's objects come through `wrappedJSObject`: a content-script function passed into a page call is refused, so a page array is copied by index and never mapped. `length` is read once.
export function copy_of(list: unknown): unknown[] {
  const source = list as Record<number, unknown> & { length?: unknown } | undefined;
  const length = source?.length;
  const copy: unknown[] = [];
  for (let index = 0; typeof length === "number" && index < Math.min(length, MAX_LEVELS); index++) copy.push(source![index]);
  return copy;
}
