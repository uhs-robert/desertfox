// The text and color state of the command line's status widgets. Pure, so the page and the host share it.

export type SecurityState = "ok" | "warn" | "neutral";

export const URL_LABEL_MAX = 30;

// By scheme only: a certificate error or mixed content needs `webRequest`, which the extension does not ask for.
export function security_state(address: string): SecurityState {
  const protocol = parse_address(address)?.protocol;
  if (protocol === "https:") return "ok";
  return protocol === "http:" ? "warn" : "neutral";
}

// Host and path without the scheme, query and fragment, cut with an ellipsis. The full address belongs in a title.
export function url_label(address: string, max = URL_LABEL_MAX): string {
  const parsed = parse_address(address);
  const shown = parsed === undefined || parsed.host === "" ? address : parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  return shown.length <= max ? shown : `${shown.slice(0, max - 1)}…`;
}

// `max` is the most the page can scroll: scroll height minus client height. A page that cannot scroll, or a NaN, is All, and a NaN `top` is Top.
export function scroll_label(top: number, max: number): string {
  if (!(max >= 1)) return "All";
  if (!(top > 0)) return "Top";
  if (top >= max - 1) return "Bot";
  return `${Math.round((top / max) * 100)}%`;
}

// `index` is zero-based, as `tabs.Tab.index` is.
export function tabs_label(index: number, count: number): string {
  return `[${index + 1}/${count}]`;
}

export type StatusWidget = { name: string; text: string; title?: string; state?: SecurityState };

// The widgets in the order of the setting. `scroll` is the host's snapshot, and a page with no scrolling element reads as All.
export function status_widgets(
  names: readonly string[],
  status: { url: string; tab_index: number; tab_count: number },
  scroll: { top: number; max: number } | null | undefined,
): StatusWidget[] {
  const widget = (name: string): StatusWidget | undefined => {
    if (name === "url") return { name, text: url_label(status.url), title: status.url, state: security_state(status.url) };
    if (name === "scroll") return { name, text: scroll_label(scroll?.top ?? 0, scroll?.max ?? 0) };
    if (name === "tabs") return { name, text: tabs_label(status.tab_index, status.tab_count) };
    return undefined;
  };
  return names.flatMap((name) => widget(name) ?? []);
}

function parse_address(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}
