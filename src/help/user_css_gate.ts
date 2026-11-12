// Keeps the user's CSS off a consent view while it is on screen. The sheet is the whole page's, so the page loses user CSS until every consent
// view is gone. A view is named, so a view drawn again (the settings route rebuilds its sections) sets the same hold, never a second one.
// The hold is the sheet's `media`, not `disabled`: setting the text of a style element makes a new sheet, which starts enabled.

export type SetUserCssHeld = (view: "import_review" | "grant_panel", held: boolean) => void;

export function create_user_css_gate(sheet: { media: string }): SetUserCssHeld {
  const holding = new Set<string>();
  return (view, held) => {
    if (held) holding.add(view);
    else holding.delete(view);
    sheet.media = holding.size > 0 ? "not all" : "";
  };
}
