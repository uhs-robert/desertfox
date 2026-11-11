// The panel that `:permissions.grant` and `:native.install` open (home.html#grant/<permission>): a button that asks for an optional permission,
// and for nativeMessaging the one-line command that installs the host. Firefox grants an optional permission only from a click on a page of the add-on,
// which is why the request lives here and not in the command.

import { copy_text } from "../content/caret/copy_text.ts";
import { host_channel, install_command } from "../shared/native_host.ts";
import { PERMISSIONS_OF, permission_of_grant_hash } from "../shared/permission_grant.ts";
import type { GrantablePermission } from "../shared/permission_grant.ts";

export type PermissionDeps = {
  has: () => Promise<boolean>;
  request: () => Promise<boolean>;
};

export type PermissionOutcome = { granted: boolean; message: string };

// What the panel says for each permission: its title, the first step, the button, and the notes after a grant and after a decline.
type GrantCopy = { title: string; ask: string; button: string; granted: string; declined: string };
const COPY: Record<GrantablePermission, GrantCopy> = {
  nativeMessaging: {
    title: "Install the native host",
    ask: "Step 1: allow DesertFox to talk to its native host.",
    button: "Allow native messaging",
    granted: "Permission granted. Run the command below in a terminal, then DesertFox can reach the host.",
    declined: "Firefox did not grant the permission. Press the button again and choose Allow. DesertFox cannot reach the host without it.",
  },
  browsingData: {
    title: "Allow clearing site data",
    ask: "The clear-and-reload keys (rc, rC) need the browsingData and cookies permissions. Firefox asks once, and the keys work at once after you allow it.",
    button: "Allow clearing site data",
    granted: "Permission granted. The clear-and-reload keys work now.",
    declined: "Firefox did not grant the permission. Press the button again and choose Allow. The clear-and-reload keys stay off without it.",
  },
};

// Must run inside the click handler: any await before `request` can lose the user gesture.
export async function ask_for_permission(deps: PermissionDeps, permission: GrantablePermission = "nativeMessaging"): Promise<PermissionOutcome> {
  try {
    const granted = await deps.request();
    return { granted, message: granted ? COPY[permission].granted : COPY[permission].declined };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { granted: false, message: `Firefox refused the permission request: ${reason}` };
  }
}

export const browser_permission_deps = (permission: GrantablePermission): PermissionDeps => {
  const request = { permissions: [...PERMISSIONS_OF[permission]] } as browser.permissions.Permissions;
  return {
    has: () => browser.permissions.contains(request),
    request: () => browser.permissions.request(request),
  };
};

const PANEL_STYLE =
  "position:fixed;top:1rem;right:1rem;z-index:2147483000;box-sizing:border-box;width:min(36rem,calc(100vw - 2rem));padding:1rem 1.25rem;" +
  "background:var(--desertfox-bg-core,#0c0e13);color:var(--desertfox-fg-core,#f5f5dc);border:1px solid var(--desertfox-primary,#7fa3c9);" +
  "border-radius:var(--desertfox-radius,6px);font:var(--desertfox-font,15px/1.5 system-ui,sans-serif);box-shadow:0 4px 24px rgba(0,0,0,.5)";
const BUTTON_STYLE = "font:inherit;padding:.25rem .75rem;cursor:pointer";

function element(tag: string, text?: string, style?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style !== undefined) node.style.cssText = style;
  return node;
}

// The host install command for this build's channel, with a Copy button.
async function append_install_steps(panel: HTMLElement): Promise<void> {
  const install_type = (await browser.management.getSelf()).installType;
  const channel = host_channel(install_type, browser.runtime.getManifest().version);
  const command = install_command(channel);
  const code = element("pre", command, "white-space:pre-wrap;word-break:break-all;margin:.5rem 0;padding:.5rem;background:rgba(127,127,127,.15)");
  const copy = element("button", "Copy command", BUTTON_STYLE);
  copy.addEventListener("click", () => {
    void copy_text(navigator.clipboard, command).then((copied) => {
      copy.textContent = copied ? "Copied" : "Copy failed, select the text instead";
    });
  });
  panel.append(
    element("p", channel === "main" ? "Step 2: run this in a terminal. It fetches the host from the main branch, with no checksum." : `Step 2: run this in a terminal. It fetches the host of version ${channel} and checks its SHA-256.`),
    code,
    copy,
  );
}

async function build_panel(permission: GrantablePermission, on_close: () => void): Promise<HTMLElement> {
  const words = COPY[permission];
  const deps = browser_permission_deps(permission);

  const panel = element("section", undefined, PANEL_STYLE);
  panel.setAttribute("aria-label", words.title);
  const status = element("p", (await deps.has()) ? "Permission already granted." : words.ask);
  status.setAttribute("role", "status");
  const allow = element("button", words.button, BUTTON_STYLE);
  allow.addEventListener("click", () => {
    void ask_for_permission(deps, permission).then((outcome) => {
      status.textContent = outcome.message;
    });
  });
  const close = element("button", "Close", `${BUTTON_STYLE};float:right`);
  close.addEventListener("click", on_close);
  panel.append(close, element("h2", words.title, "margin:0 0 .5rem;font-size:1.1rem"), status, allow);
  if (permission === "nativeMessaging") await append_install_steps(panel);
  return panel;
}

export type PanelControllerDeps<Panel> = {
  is_wanted: () => boolean;
  build: () => Promise<Panel>;
  show: (panel: Panel) => void;
  hide: (panel: Panel) => void;
};
export type PanelController = { sync: () => Promise<void>; close: () => void };

// `sync` is called on every route change. A build that finishes after a newer `sync` started, or after the route left, is dropped,
// so two quick changes never leave two panels.
export function create_panel_controller<Panel>(deps: PanelControllerDeps<Panel>): PanelController {
  let shown: Panel | undefined;
  let latest_sync = 0;
  return {
    // The user closed the panel. Forget it, so the next wanted sync builds a new one.
    close: () => {
      if (shown !== undefined) deps.hide(shown);
      shown = undefined;
    },
    sync: async () => {
      const this_sync = ++latest_sync;
      if (!deps.is_wanted()) {
        if (shown !== undefined) deps.hide(shown);
        shown = undefined;
        return;
      }
      if (shown !== undefined) return;
      const built = await deps.build();
      if (this_sync !== latest_sync || shown !== undefined || !deps.is_wanted()) return;
      shown = built;
      deps.show(built);
    },
  };
}

// The panel sits outside the body because the help router rebuilds the body on every route change.
export function mount_grant_panel(): void {
  const controller: PanelController = create_panel_controller<HTMLElement>({
    is_wanted: () => permission_of_grant_hash(location.hash) !== undefined,
    build: () => build_panel(permission_of_grant_hash(location.hash)!, () => controller.close()),
    show: (panel) => document.documentElement.append(panel),
    hide: (panel) => panel.remove(),
  });
  window.addEventListener("hashchange", () => void controller.sync());
  void controller.sync();
}
