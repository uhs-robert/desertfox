// Which elements count as headings. A leaf module: `headings.ts` imports `candidates.ts`, and the `headings` filter of `candidates.ts` needs these, so they live here and this file imports neither.

export const HEADINGS = "h1, h2, h3, h4, h5, h6, [role=heading]";

// The text a person reads: it leaves out hidden text and script text, which `textContent` would add. A fake element in a test has no `innerText`.
// A heading often keeps its text in a child span, so the test reads the rendered text and not the text nodes of the element.
export const rendered_text = (element: Element): string => ((element as HTMLElement).innerText ?? element.textContent ?? "").trim();

// The role wins over the tag, so `<h2 role=presentation>` and `<h2 role=button>` are no heading. An empty heading is no jump target.
export const is_heading = (element: Element): boolean => {
  const role = element.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase();
  return (role === undefined || role === "" || role === "heading") && rendered_text(element) !== "";
};
