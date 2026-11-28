// What the find line of a locked page and the extension agree on: the longest text, the panel mode of each direction and the cleaning of the typed text. The module keeps its own copy of the cap and the cleaning.

export const MAX_FIND_CHARS = 256;
export type FindDirection = "forward" | "backward";
export const find_mode_of = (direction: FindDirection): string => `find_${direction}`;
export const find_direction_of = (mode: string): FindDirection | undefined => (mode === "find_forward" ? "forward" : mode === "find_backward" ? "backward" : undefined);

// Control and format characters go, then the cut at the cap, so the module never refuses the text on its shape.
export const cleaned_find_text = (text: string): string => [...text.replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, MAX_FIND_CHARS).join("");
