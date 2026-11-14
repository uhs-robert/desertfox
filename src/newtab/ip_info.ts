// The IP info card. Cloudflare's trace page answers with the caller's public IP and country. It is off unless `newtab_ip_info` is true, and nothing but those two fields is read from the answer.
import type { Settings } from "../shared/config.ts";
import { refused_as } from "../shared/swallow.ts";
import { browser_net_env, fetch_text, load_cached, net_cache_key, stoppable_net, type NetEnv } from "./net_widget.ts";

export type IpInfoSettings = Pick<Settings, "newtab_ip_info">;

export const IP_TRACE_URL = "https://1.1.1.1/cdn-cgi/trace";
// The stored address draws first, and each new tab refreshes it once the stored one is a minute old. Checking a VPN or a network change is the reason to look at this card, so a longer wait would show the old address.
export const IP_TTL_MS = 60_000;
export const IP_MAX_AGE_MS = 3_600_000;

export type IpInfo = { ip: string; country: string };

export type IpInfoDeps = { page_is_private: () => Promise<boolean>; net: NetEnv };

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

// The URL parser holds the full IPv6 grammar, so it decides the colon forms. The character test first keeps it from reading anything but an address.
function is_ipv6(text: string): boolean {
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(text) || !text.includes(":")) return false;
  try {
    return new URL(`http://[${text}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

export const is_ip_address = (text: string): boolean => IPV4.test(text) || is_ipv6(text);

const is_country_code = (text: string): boolean => /^[A-Z]{2}$/.test(text);

// The trace answer is `key=value` lines. Only `ip` and `loc` are taken, and each must look like itself, so a captive portal page never draws as an address.
export function parse_trace(text: string): IpInfo | undefined {
  const fields = new Map(text.split("\n").map((line) => line.trim().split("=", 2) as [string, string | undefined]));
  const ip = fields.get("ip");
  const country = fields.get("loc");
  if (ip === undefined || country === undefined || !is_ip_address(ip) || !is_country_code(country)) return undefined;
  return { ip, country };
}

const is_ip_info = (stored: unknown): stored is IpInfo => {
  const value = stored as Partial<IpInfo> | undefined;
  return typeof value?.ip === "string" && is_ip_address(value.ip) && typeof value.country === "string" && is_country_code(value.country);
};

// Calls `show` with what the card draws, possibly twice (a stored value, then a fresh one). It draws nothing when the setting is off, the page is private or the fetch fails.
export async function run_ip_info(settings: IpInfoSettings, deps: IpInfoDeps, show: (info: IpInfo) => void): Promise<void> {
  if (settings.newtab_ip_info !== true) return;
  if (await refused_as(deps.page_is_private(), true)) return;
  const produce = async () => {
    const text = await fetch_text(IP_TRACE_URL, deps.net);
    return text === undefined ? undefined : parse_trace(text);
  };
  await load_cached<IpInfo>({ name: "ip", key: "trace", ttl_ms: IP_TTL_MS, max_age_ms: IP_MAX_AGE_MS, produce, is_value: is_ip_info }, deps.net, show);
}

// The page calls this while the setting is off, so turning the card off also drops the last address from storage.
export async function forget_ip_info(remove: (key: string) => Promise<void> = (key) => browser.storage.local.remove(key)): Promise<void> {
  await remove(net_cache_key("ip"));
}

const country_name = (code: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

// One muted line, such as `203.0.113.7, Norway`, for the centered column under the date.
export function draw_ip_info(slot: HTMLElement, info: IpInfo): void {
  slot.textContent = `${info.ip}, ${country_name(info.country)}`;
}

export const browser_ip_info_deps = (): IpInfoDeps => ({ page_is_private: async () => (await browser.windows.getCurrent()).incognito, net: browser_net_env() });

// Fills `slot` and keeps the page free: nothing here is awaited by the draw, and a failure leaves the slot empty. `stop` ends the run, so a redraw never lets a late answer reach a page that left.
export function start_ip_info(slot: HTMLElement, settings: IpInfoSettings, deps: IpInfoDeps = browser_ip_info_deps()): { finished: Promise<void>; stop: () => void } {
  let live = true;
  const guarded = { ...deps, net: stoppable_net(deps.net, () => live) };
  const finished = refused_as(
    run_ip_info(settings, guarded, (info) => live && draw_ip_info(slot, info)),
    undefined,
  ) as Promise<void>;
  return { finished, stop: () => void (live = false) };
}
