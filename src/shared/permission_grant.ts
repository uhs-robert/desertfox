// The optional permissions a user grants from a panel on the Help page, and the hash that opens the panel.
// Pure, so the Help page, the background and the commands share it.

// What the `permissions.grant` command accepts. The name says what the permission is for, so a refusal can hand it over as it is.
export const GRANTABLE_PERMISSIONS = ["nativeMessaging", "browsingData"] as const;
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

// One grant can ask for several manifest permissions, so the table stays a list.
export const PERMISSIONS_OF: Record<GrantablePermission, readonly string[]> = {
  nativeMessaging: ["nativeMessaging"],
  browsingData: ["browsingData"],
};

// The hash `permissions.grant` opens on the Help page. Help's router shows Home for it, and the grant panel reads it.
const GRANT_HASH_PREFIX = "#grant/";

// Each grant adds a fresh suffix, so a tab already on the page sees a hash change and shows the panel again.
export const grant_hash = (permission: GrantablePermission, nonce: number): string => `${GRANT_HASH_PREFIX}${permission}?${nonce}`;

export function permission_of_grant_hash(hash: string): GrantablePermission | undefined {
  if (!hash.startsWith(GRANT_HASH_PREFIX)) return undefined;
  const name = hash.slice(GRANT_HASH_PREFIX.length).split("?")[0];
  return GRANTABLE_PERMISSIONS.find((permission) => permission === name);
}

export const grant_hint = (permission: GrantablePermission): string => `Run :permissions.grant ${permission}, then press Allow on the page.`;
