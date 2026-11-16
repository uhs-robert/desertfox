// Read on every call, not cached, so a change to the setting in Firefox applies without a reload. Firefox's own smooth-scroll pref does not follow reduced motion for a script's scroll.
export const smooth_behavior = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
