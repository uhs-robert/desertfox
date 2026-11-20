// The checkbox of an item. A site row can name it with `target`, a CSS selector. Otherwise it is the first native checkbox that shows, then the first element with role=checkbox that shows.

import { is_shown } from "../shown.ts";

const NATIVE_CHECKBOX = 'input[type="checkbox"]';
const ARIA_CHECKBOX = '[role="checkbox"]';

export const checkbox_in = (item: Element, target = ""): Element | undefined => {
  const first_shown = (selector: string) => Array.from(item.querySelectorAll(selector)).find(is_shown);
  return target ? first_shown(target) : (first_shown(NATIVE_CHECKBOX) ?? first_shown(ARIA_CHECKBOX));
};
