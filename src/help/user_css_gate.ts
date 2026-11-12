// Keeps the user's CSS off a consent view while it is on screen. The sheet is the whole page's, so the page loses user CSS until every consent
// view is gone. Each mounted view opens its own hold, so a view that is gone (the settings route rebuilds its sections) cannot release the hold
// of the view that replaced it: `dispose` ends a hold for good and later calls on it do nothing.
// The hold is the sheet's `media`, not `disabled`: setting the text of a style element makes a new sheet, which starts enabled.

export type UserCssHold = { set: (held: boolean) => void; dispose: () => void };

export const NO_USER_CSS_HOLD: UserCssHold = { set: () => {}, dispose: () => {} };

export function create_user_css_gate(sheet: { media: string }): () => UserCssHold {
  const holding = new Set<UserCssHold>();
  const apply = () => {
    sheet.media = holding.size > 0 ? "not all" : "";
  };
  return () => {
    let live = true;
    const hold: UserCssHold = {
      set: (held) => {
        if (!live) return;
        if (held) holding.add(hold);
        else holding.delete(hold);
        apply();
      },
      dispose: () => {
        live = false;
        holding.delete(hold);
        apply();
      },
    };
    return hold;
  };
}
