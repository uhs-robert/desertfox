// Guard for the Firefox internals the key tests reach into. One chrome evaluation per shard names a broken internal
// and the running Firefox version, so a Firefox update shows up as one clear failure and not as a late timeout.
// There is no list of known-good versions: an update that breaks nothing must not fail the run.
import { evaluate_in_chrome } from "./rdp.mjs";

// Each check is chrome code that returns true when the internal is intact. `used_for` says what breaks without it.
const CHECKS = [
  {
    name: "ExtensionPageChild.sys.mjs",
    used_for: "evaluate_in_page_frames in rdp.mjs reaches a chrome global with BrowsingContext through it",
    code: `Boolean(ChromeUtils.importESModule("resource://gre/modules/ExtensionPageChild.sys.mjs"))`,
  },
  {
    name: "window.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.domProcess.osPid",
    used_for: "evaluate_in_page_frames in rdp.mjs walks the selected tab's browsing contexts this way",
    code: `(() => {
      const context = Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browsingContext;
      const global = context.currentWindowGlobal;
      return typeof global.documentURI.spec === "string" && typeof global.domProcess.osPid === "number" && Symbol.iterator in Object(context.children);
    })()`,
  },
  {
    name: "ExtensionSettingsStore.initialize and addSetting",
    used_for: "the session setup confirms the new tab notice through them",
    code: `(() => {
      const { ExtensionSettingsStore } = ChromeUtils.importESModule("resource://gre/modules/ExtensionSettingsStore.sys.mjs");
      return typeof ExtensionSettingsStore.initialize === "function" && typeof ExtensionSettingsStore.addSetting === "function";
    })()`,
  },
  {
    name: "ExtensionPermissions.add and WebExtensionPolicy.getByID(id).extension",
    used_for: "the session setup grants nativeMessaging through them",
    code: `(() => {
      const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
      return typeof ExtensionPermissions.add === "function" && Boolean(WebExtensionPolicy.getByID(EXTENSION_ID)?.extension);
    })()`,
  },
  {
    name: "window.gURLBar.value",
    used_for: "type_in_address_bar types into the address bar and reads it back",
    code: `typeof Services.wm.getMostRecentWindow("navigator:browser").gURLBar.value === "string"`,
  },
];

export const firefox_label = ({ version, build_id }) => `Firefox ${version}${build_id ? `, build ${build_id}` : ""}`;

export function broken_message(name, used_for, firefox) {
  return `Firefox internal broken: ${name} (${firefox_label(firefox)}). ${used_for}. See test/key/README.md "Firefox internals".`;
}

// A late failure from code that uses an internal gets the version, so it reads as a possible Firefox change.
export function with_firefox_version(error, firefox) {
  if (!firefox) return error;
  return new Error(`${error.message} (${firefox_label(firefox)}; if this follows a Firefox update see test/key/README.md "Firefox internals")`, { cause: error });
}

// Returns `{ version, build_id }` and throws on the first broken internal. A check that throws counts as broken.
export async function check_firefox_internals(rdp, extension_id) {
  const checks_code = CHECKS.map(({ code }) => `(() => { try { return ${code}; } catch (error) { return false; } })()`).join(", ");
  const answer = await evaluate_in_chrome(rdp, `(() => {
    const EXTENSION_ID = ${JSON.stringify(extension_id)};
    return { version: Services.appinfo.version, build_id: Services.appinfo.appBuildID, results: [${checks_code}] };
  })()`);
  if (answer?.error) throw new Error(`reading the Firefox version failed: ${answer.error}`);
  const firefox = { version: answer.version, build_id: answer.build_id };
  const broken = CHECKS.find((_, index) => answer.results[index] !== true);
  if (broken) throw new Error(broken_message(broken.name, broken.used_for, firefox));
  return firefox;
}
