// Firefox gives content scripts closed shadow roots through openOrClosedShadowRoot.
export const shadow_root_of = (element: Element): ShadowRoot | null =>
  (element as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? element.shadowRoot;
