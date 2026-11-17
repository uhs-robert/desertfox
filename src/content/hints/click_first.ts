// `page.click`: a hint click on a control that a site row names by selector, for a site whose script opens it only on a click.

// The page, the visibility rule and the click are parameters, so a test passes fakes. Answers the refusal message, or nothing once it clicked.
export function click_first_shown<T>(doc: { querySelectorAll(selector: string): ArrayLike<T> }, selector: string, shown: (element: T) => boolean, click: (element: T) => void): string | undefined {
  let matches: T[];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
  } catch {
    return `${selector} is not a valid CSS selector`;
  }
  // A page often keeps hidden copies of a control (a closed menu, the other view), so the first one the user can see is the one clicked.
  const target = matches.find(shown);
  if (target === undefined) return `Nothing shown on the page matches ${selector}`;
  click(target);
  return undefined;
}
