const port = browser.runtime.connectNative("key_spike");
const log = (obj) => port.postMessage({ ...obj, bg_ms: Date.now() });
const echo_waiters = [];
port.onMessage.addListener((msg) => { if (msg.kind === "echo") echo_waiters.shift()?.(); });

async function native_bench() {
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now();
    await new Promise((resolve) => { echo_waiters.push(resolve); port.postMessage({ kind: "echo" }); });
    samples.push(performance.now() - start);
  }
  log({ kind: "bench_result", what: "background_to_native_roundtrip_ms", samples });
}

async function switch_tab(step, cause) {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const active = tabs.findIndex((tab) => tab.active);
  const target = tabs[(active + step + tabs.length) % tabs.length];
  await browser.tabs.update(target.id, { active: true });
  log({ kind: "switched", cause, from: tabs[active].url, to: target.url });
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.kind === "ping") return Promise.resolve(true);
  log({ ...msg, tab: sender.tab?.id, frame: sender.frameId });
  if (msg.kind === "discard_others") browser.tabs.query({ currentWindow: true, active: false }).then((tabs) => browser.tabs.discard(tabs.map((t) => t.id)));
  if (msg.kind === "key") switch_tab(msg.key === "J" ? 1 : -1, "content");
  if (msg.kind === "ready" && msg.url.includes("/bench")) browser.tabs.sendMessage(sender.tab.id, { kind: "bench" });
});
browser.commands.onCommand.addListener((name, tab) => {
  log({ kind: "command", name, tab_url: tab?.url });
  switch_tab(name === "tab_next" ? 1 : -1, "command");
});
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId);
  log({ kind: "activated", url: tab.url, status: tab.status, discarded: tab.discarded });
});
browser.commands.getAll().then((cmds) => log({ kind: "commands", cmds }));
log({ kind: "background_up" });
native_bench();
