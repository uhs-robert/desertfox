// The public address and city, from ipwho.is. The request carries no data of ours: the service sees the address it is asked about.
export type IpInfo = { ip: string; city: string; latitude: number; longitude: number };

export const IP_URL = "https://ipwho.is/";

export function parse_ip_response(body: unknown): IpInfo | null {
  if (typeof body !== "object" || body === null) return null;
  const { success, ip, city, latitude, longitude } = body as Record<string, unknown>;
  if (success === false || typeof ip !== "string" || ip === "") return null;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return { ip, city: typeof city === "string" ? city : "", latitude, longitude };
}

export async function fetch_ip_info(fetch_json: (url: string) => Promise<unknown>): Promise<IpInfo | null> {
  try {
    return parse_ip_response(await fetch_json(IP_URL));
  } catch {
    return null;
  }
}
