// Marks every badge host so a cleanup never touches page elements. An instance orphaned by an extension reload leaves its host behind.
export const BADGE_HOST_ATTRIBUTE = "data-oasisfox-badge";

export const remove_badge_hosts = (): void => document.documentElement.querySelectorAll(`:scope > [${BADGE_HOST_ATTRIBUTE}]`).forEach((host) => host.remove());
