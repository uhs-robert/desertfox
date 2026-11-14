// A real mouse press through the widget at an offset inside an element of the active tab, so the page gets trusted events and user activation.
import { evaluate_in_chrome } from "./rdp.mjs";

export async function click_element(rdp, in_active_tab, element_id, dx = 150, dy = 150) {
  const [x, y] = await in_active_tab(`(() => { const box = document.getElementById(${JSON.stringify(element_id)}).getBoundingClientRect(); return [box.left + ${dx}, box.top + ${dy}]; })()`);
  await evaluate_in_chrome(rdp, `(async () => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const browser = win.gBrowser.selectedBrowser;
    const box = browser.getBoundingClientRect();
    const at = [(win.mozInnerScreenX + box.left + ${x}) * win.devicePixelRatio, (win.mozInnerScreenY + box.top + ${y}) * win.devicePixelRatio];
    for (const message of [win.windowUtils.NATIVE_MOUSE_MESSAGE_MOVE, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_UP]) {
      win.windowUtils.sendNativeMouseEvent(at[0], at[1], message, 0, 0, browser, null);
      await new Promise((resolve) => win.setTimeout(resolve, 20));
    }
  })()`);
}
