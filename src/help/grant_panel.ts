// The panel that `:permissions.grant` and `:native.install` open (home.html#grant/<permission>): a button that asks for an optional permission,
// and for nativeMessaging the one-line command that installs the host. Firefox grants an optional permission only from a click on a page of the add-on,
// which is why the request lives here and not in the command.

import { copy_text } from "../content/caret/copy_text.ts";
import { host_channel, install_hashes_of, main_install_command, release_install_command, type InstallHashes } from "../shared/native_host.ts";
import { PERMISSIONS_OF, permission_of_grant_hash } from "../shared/permission_grant.ts";
import type { GrantablePermission } from "../shared/permission_grant.ts";
import { NO_USER_CSS_HOLD, type UserCssHold } from "./user_css_gate.ts";
import type { ChangeSetting, ChangeSettingAnswer } from "../shared/messages.ts";

export type PermissionDeps = {
  has: () => Promise<boolean>;
  request: () => Promise<boolean>;
};

export const AUTO_UPDATE_SETTING = "host_auto_update";
export const AUTO_UPDATE_BUTTON = "Install and keep the host updated";

// The consent button saves `host_auto_update` and installs nothing: Firefox cannot run the command, so the user runs it.
// The page text is the disclosure of what the setting allows.
export async function consent_to_auto_update(send: (message: ChangeSetting) => Promise<unknown>): Promise<string> {
  try {
    const answer = (await send({ type: "change_setting", name: AUTO_UPDATE_SETTING, action: "set", value: true })) as ChangeSettingAnswer | undefined;
    if (answer?.ok === true) return "Saved. After you run the command, the host updates itself to match the extension, and a toast says so.";
    return `DesertFox could not save the setting: ${answer?.message ?? "no answer"}`;
  } catch (error) {
    return `DesertFox could not save the setting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

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
    ask: "The clear-and-reload keys (rc, rC) need the browsingData permission. Firefox asks once, and the keys work at once after you allow it.",
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

// `just release_stamp` writes the file and the build copies it, so a signed build carries it and an unstamped build has none.
async function read_install_hashes(version: string): Promise<InstallHashes | undefined> {
  try {
    return install_hashes_of(await (await fetch(browser.runtime.getURL("host_sha256.json"))).json(), version);
  } catch {
    return undefined;
  }
}

// The step text and command for this build. A release build without the signed hashes gets the unchecked main command,
// never a release command it cannot check.
export function install_step(channel: string, hashes: InstallHashes | undefined): { text: string; command: string; checked: boolean } {
  if (channel !== "main" && hashes !== undefined) {
    return {
      text: `Step 2: run this in a terminal. It fetches the install script and the host of version ${channel} and checks each against the SHA-256 this signed build carries.`,
      command: release_install_command(channel, hashes),
      checked: true,
    };
  }
  const reason = channel === "main" ? "This is a development install, so" : "This build carries no host hashes, so";
  return {
    text: `Step 2: run this in a terminal. Warning: ${reason} the command fetches the host from the main branch with no checksum. Use it for development only.`,
    command: main_install_command(),
    checked: false,
  };
}

// The host install command for this build's channel, with a Copy button.
async function append_install_steps(panel: HTMLElement): Promise<void> {
  const install_type = (await browser.management.getSelf()).installType;
  const version = browser.runtime.getManifest().version;
  const channel = host_channel(install_type, version);
  const { text, command, checked } = install_step(channel, channel === "main" ? undefined : await read_install_hashes(version));
  const code = element("pre", command, "white-space:pre-wrap;word-break:break-all;margin:.5rem 0;padding:.5rem;background:rgba(127,127,127,.15)");
  const copy = element("button", "Copy command", BUTTON_STYLE);
  copy.addEventListener("click", () => {
    void copy_text(navigator.clipboard, command).then((copied) => {
      copy.textContent = copied ? "Copied" : "Copy failed, select the text instead";
    });
  });
  panel.append(element("p", text), code, copy);
  // Without the signed hashes the host cannot update itself either, so the consent has nothing to allow.
  if (!checked) return;
  const consent_status = element("p", undefined, "margin:.5rem 0 0");
  consent_status.setAttribute("role", "status");
  const consent = element("button", AUTO_UPDATE_BUTTON, `${BUTTON_STYLE};margin-top:.5rem`);
  consent.addEventListener("click", () => {
    void consent_to_auto_update((message) => browser.runtime.sendMessage(message)).then((text) => {
      consent_status.textContent = text;
    });
  });
  panel.append(
    element("p", "After this first install the host updates itself. When the extension updates, a host that is older fetches the matching release from GitHub over HTTPS and checks its SHA-256 against hashes inside the signed extension. Each update shows a toast. This button allows that. Without it, run :native.update when the extension says the host is older.", "margin:.75rem 0 0"),
    consent,
    consent_status,
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
  // The key of the panel the route wants, or undefined for none. A new key replaces the shown panel.
  wanted: () => string | undefined;
  build: () => Promise<Panel>;
  show: (panel: Panel) => void;
  hide: (panel: Panel) => void;
};
export type PanelController = { sync: () => Promise<void>; close: () => void };

// `sync` is called on every route change. A build that finishes after a newer `sync` started, or after the route left, is dropped,
// so two quick changes never leave two panels.
export function create_panel_controller<Panel>(deps: PanelControllerDeps<Panel>): PanelController {
  let shown: Panel | undefined;
  let shown_key: string | undefined;
  let latest_sync = 0;
  return {
    // The user closed the panel. Forget it, so the next wanted sync builds a new one.
    close: () => {
      if (shown !== undefined) deps.hide(shown);
      shown = undefined;
      shown_key = undefined;
    },
    sync: async () => {
      const this_sync = ++latest_sync;
      const key = deps.wanted();
      if (key === undefined || key !== shown_key) {
        if (shown !== undefined) deps.hide(shown);
        shown = undefined;
        shown_key = undefined;
      }
      if (key === undefined || shown !== undefined) return;
      const built = await deps.build();
      if (this_sync !== latest_sync || shown !== undefined || deps.wanted() !== key) return;
      shown = built;
      shown_key = key;
      deps.show(built);
    },
  };
}

// The panel sits outside the body because the help router rebuilds the body on every route change.
export function mount_grant_panel(user_css_hold: UserCssHold = NO_USER_CSS_HOLD): void {
  const controller: PanelController = create_panel_controller<HTMLElement>({
    wanted: () => permission_of_grant_hash(location.hash),
    build: () => build_panel(permission_of_grant_hash(location.hash)!, () => controller.close()),
    show: (panel) => {
      user_css_hold.set(true);
      document.documentElement.append(panel);
    },
    hide: (panel) => {
      user_css_hold.set(false);
      panel.remove();
    },
  });
  window.addEventListener("hashchange", () => void controller.sync());
  void controller.sync();
}
