// CSS custom properties of a theme. A role's token is `--oasisfox-` plus the role with underscores as hyphens.

import { ROLES } from "./roles.ts";
import type { Role, RoleColors } from "./roles.ts";

export function token_name(role: Role): string {
  return `--oasisfox-${role.replaceAll("_", "-")}`;
}

export function role_tokens(colors: RoleColors): Record<string, string> {
  return Object.fromEntries(ROLES.map((role) => [token_name(role), colors[role]]));
}
