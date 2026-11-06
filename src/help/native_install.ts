// The panel that `:native.install` opens (help.html#native-install): a button that asks for the nativeMessaging permission
// and the one-line command that installs the host. Firefox grants an optional permission only from a click on a page of the add-on,
// which is why the request lives here and not in the command.

import { copy_text } from "../content/caret/copy_text.ts";
import { host_channel, install_command, is_native_install_hash, NATIVE_PERMISSION } from "../shared/native_host.ts";

export type PermissionDeps = {
  has: () => Promise<boolean>;
  request: () => Promise<boolean>;
};

export type PermissionOutcome = { granted: boolean; message: string };

// Must run inside the click handler: any await before `request` can lose the user gesture.
export async function ask_for_permission(deps: PermissionDeps): Promise<PermissionOutcome> {
  try {
    const granted = await deps.request();
    return granted
      ? { granted, message: "Permission granted. Run the command below in a terminal, then DesertFox can reach the host." }
      : { granted, message: "Firefox did not grant the permission. Press the button again and choose Allow. DesertFox cannot reach the host without it." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { granted: false, message: `Firefox refused the permission request: ${reason}` };
  }
}

export const browser_permission_deps = (): PermissionDeps => ({
  has: () => browser.permissions.contains({ permissions: [NATIVE_PERMISSION] }),
  request: () => browser.permissions.request({ permissions: [NATIVE_PERMISSION] }),
});

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

async function build_panel(on_close: () => void): Promise<HTMLElement> {
  const install_type = (await browser.management.getSelf()).installType;
  const channel = host_channel(install_type, browser.runtime.getManifest().version);
  const command = install_command(channel);
  const deps = browser_permission_deps();

  const panel = element("section", undefined, PANEL_STYLE);
  panel.setAttribute("aria-label", "Install the native host");
  const status = element("p", (await deps.has()) ? "Permission already granted." : "Step 1: allow DesertFox to talk to its native host.");
  status.setAttribute("role", "status");
  const allow = element("button", "Allow native messaging", BUTTON_STYLE);
  allow.addEventListener("click", () => {
    void ask_for_permission(deps).then((outcome) => {
      status.textContent = outcome.message;
    });
  });
  const code = element("pre", command, "white-space:pre-wrap;word-break:break-all;margin:.5rem 0;padding:.5rem;background:rgba(127,127,127,.15)");
  const copy = element("button", "Copy command", BUTTON_STYLE);
  copy.addEventListener("click", () => {
    void copy_text(navigator.clipboard, command).then((copied) => {
      copy.textContent = copied ? "Copied" : "Copy failed, select the text instead";
    });
  });
  const close = element("button", "Close", `${BUTTON_STYLE};float:right`);
  close.addEventListener("click", on_close);
  panel.append(
    close,
    element("h2", "Install the native host", "margin:0 0 .5rem;font-size:1.1rem"),
    status,
    allow,
    element("p", channel === "main" ? "Step 2: run this in a terminal. It fetches the host from the main branch, with no checksum." : `Step 2: run this in a terminal. It fetches the host of version ${channel} and checks its SHA-256.`),
    code,
    copy,
  );
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
export function mount_native_install(): void {
  const controller: PanelController = create_panel_controller<HTMLElement>({
    is_wanted: () => is_native_install_hash(location.hash),
    build: () => build_panel(() => controller.close()),
    show: (panel) => document.documentElement.append(panel),
    hide: (panel) => panel.remove(),
  });
  window.addEventListener("hashchange", () => void controller.sync());
  void controller.sync();
}
