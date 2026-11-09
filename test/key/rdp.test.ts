import assert from "node:assert/strict";
import net from "node:net";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { connect_rdp, evaluate_in_background, evaluate_in_chrome } = await import(join(import.meta.dirname, "rdp.mjs"));

type Packet = { to: string; type?: string; text?: string; [key: string]: unknown };
type Fake = { port: number; sent: Packet[]; send: (packet: object) => void; send_bytes: (bytes: Uint8Array) => void; close: () => void };

const frame = (packet: object): Buffer => {
  const text = JSON.stringify(packet);
  return Buffer.from(`${Buffer.byteLength(text)}:${text}`);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A debugger server that greets like Firefox and hands each request to `on_packet`, which answers with fake.send.
async function fake_server(on_packet: (packet: Packet, fake: Fake) => void, greeting: "greets" | "closes" | "stays silent" = "greets"): Promise<Fake> {
  let connection: net.Socket | undefined;
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    connection = socket;
    sockets.push(socket);
    socket.setNoDelay(true);
    if (greeting === "closes") socket.destroy();
    else if (greeting === "greets") socket.write(frame({ from: "root", applicationType: "browser" }));
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const colon = pending.indexOf(":");
        if (colon < 0) return;
        const length = Number(pending.subarray(0, colon).toString());
        if (pending.length < colon + 1 + length) return;
        const packet = JSON.parse(pending.subarray(colon + 1, colon + 1 + length).toString());
        pending = pending.subarray(colon + 1 + length);
        fake.sent.push(packet);
        on_packet(packet, fake);
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fake: Fake = {
    port: (server.address() as net.AddressInfo).port,
    sent: [],
    send: (packet) => { connection!.write(frame(packet)); },
    send_bytes: (bytes) => { connection!.write(bytes); },
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  };
  return fake;
}

// Runs `body` against a fresh server and client, and closes both.
async function with_rdp(on_packet: (packet: Packet, fake: Fake) => void, body: (rdp: any, fake: Fake) => Promise<void>, options: object = {}) {
  const fake = await fake_server(on_packet);
  const rdp = await connect_rdp(fake.port, options);
  try {
    await body(rdp, fake);
  } finally {
    rdp.close();
    fake.close();
  }
}

const ADDON = "fake@addon";
const background_form = (target_actor: string, console_actor: string) => ({
  from: "watcher1",
  type: "target-available-form",
  target: { actor: target_actor, consoleActor: console_actor, url: "moz-extension://x/_generated_background_page.html" },
});

// A Firefox with one add-on. Its watcher sends the background form once, on the first watchTargets only, as Firefox does.
// `on_console` handles the console actors: it gets each evaluation's text and the fake, and returns what to do with it.
function addon_firefox(on_console: (packet: Packet, fake: Fake, slots: Map<string, string>) => void) {
  const slots = new Map<string, string>();
  let watched = false;
  return (packet: Packet, fake: Fake) => {
    if (packet.to === "root" && packet.type === "listAddons") fake.send({ from: "root", addons: [{ id: ADDON, actor: "addon1" }] });
    else if (packet.to === "addon1") fake.send({ from: "addon1", actor: "watcher1" });
    else if (packet.to === "watcher1") {
      fake.send({ from: "watcher1" });
      if (!watched) fake.send(background_form("target1", "console1"));
      watched = true;
    } else on_console(packet, fake, slots);
  };
}

// Answers the key test's two-step evaluation: a start that names a slot, then polls that read the slot.
// The code is a JSON literal, so the fake can "run" it by reading it back.
let next_result_id = 1;
function answer_evaluation(packet: Packet, fake: Fake, slots: Map<string, string>, console_actor = packet.to) {
  const resultID = `r${next_result_id++}`;
  const text = packet.text as string;
  const start = text.match(/globalThis\.(__key_test_\w+) = undefined; \(async \(\) => (.*)\)\(\)\.then/);
  let result: string | undefined;
  if (start) {
    slots.set(start[1]!, JSON.stringify(JSON.parse(start[2]!)));
    result = "started";
  } else {
    result = slots.get(text.replace("globalThis.", "")) ?? "";
  }
  fake.send({ from: console_actor, resultID });
  fake.send({ from: console_actor, type: "evaluationResult", resultID, result });
}

test("a reply that arrives late, after its caller timed out, does not answer the next caller", async () => {
  // Race: caller 1 gives up, then its reply and caller 2's reply both arrive. The first reply on the actor belongs to caller 1.
  await with_rdp(() => {}, async (rdp, fake) => {
    await assert.rejects(rdp.request("actor1", { type: "first" }), /no answer from actor1/);
    const second = rdp.request("actor1", { type: "second" });
    fake.send({ from: "actor1", answer: "late reply to first" });
    fake.send({ from: "actor1", answer: "reply to second" });
    assert.equal((await second).answer, "reply to second");
  }, { request_timeout_ms: 100 });
});

test("a late reply that arrives before the next request is dropped", async () => {
  await with_rdp(() => {}, async (rdp, fake) => {
    await assert.rejects(rdp.request("actor1", { type: "first" }), /no answer/);
    fake.send({ from: "actor1", answer: "late reply to first" });
    await sleep(20);
    const second = rdp.request("actor1", { type: "second" });
    fake.send({ from: "actor1", answer: "reply to second" });
    assert.equal((await second).answer, "reply to second");
  }, { request_timeout_ms: 100 });
});

test("replies of different actors reach their callers in any order", async () => {
  const requests: Packet[] = [];
  await with_rdp((packet, fake) => {
    requests.push(packet);
    if (requests.length === 2) {
      fake.send({ from: "actor_b", answer: "b" });
      fake.send({ from: "actor_a", answer: "a" });
    }
  }, async (rdp) => {
    const [a, b] = await Promise.all([rdp.request("actor_a", { type: "ask" }), rdp.request("actor_b", { type: "ask" })]);
    assert.deepEqual([a.answer, b.answer], ["a", "b"]);
  });
});

test("events between a request and its reply stay events", async () => {
  await with_rdp((packet, fake) => {
    fake.send({ from: "actor1", type: "frameUpdate", note: "event before the reply" });
    fake.send({ from: "actor1", answer: "reply" });
    fake.send({ from: "actor1", type: "frameUpdate", note: "event after the reply" });
  }, async (rdp) => {
    const reply = await rdp.request("actor1", { type: "ask" });
    assert.equal(reply.answer, "reply");
    assert.equal((await rdp.next_event("actor1", (event: any) => event.type === "frameUpdate")).note, "event before the reply");
    assert.equal((await rdp.next_event("actor1", (event: any) => event.type === "frameUpdate")).note, "event after the reply");
  });
});

test("an event reader waits for an event that arrives later and times out on none", async () => {
  await with_rdp(() => {}, async (rdp, fake) => {
    const waiting = rdp.next_event("actor1", (event: any) => event.type === "ping", 2000);
    await sleep(20);
    fake.send({ from: "actor1", type: "ping" });
    assert.equal((await waiting).type, "ping");
    await assert.rejects(rdp.next_event("actor1", (event: any) => event.type === "ping", 50), /no event from actor1/);
  });
});

test("concurrent requests to one actor each get their own reply, in order", async () => {
  const requests: Packet[] = [];
  await with_rdp((packet, fake) => {
    requests.push(packet);
    if (requests.length === 3) for (const request of requests) fake.send({ from: "actor1", answer: `reply to ${request.type}` });
  }, async (rdp) => {
    const replies = await Promise.all(["one", "two", "three"].map((type) => rdp.request("actor1", { type })));
    assert.deepEqual(replies.map((reply: any) => reply.answer), ["reply to one", "reply to two", "reply to three"]);
  });
});

test("concurrent evaluations on one console each get their own result", { timeout: 40000 }, async () => {
  // Race: both starts are acknowledged and answered before either poll. An ack taken for a result event, or the reverse, leaves a caller waiting.
  const firefox = addon_firefox((packet, fake, slots) => answer_evaluation(packet, fake, slots));
  await with_rdp(firefox, async (rdp) => {
    assert.equal(await evaluate_in_background(rdp, ADDON, `"warm up"`), "warm up");
    const values = await Promise.all([`"alpha"`, `"beta"`, `"gamma"`].map((code) => evaluate_in_background(rdp, ADDON, code)));
    assert.deepEqual(values, ["alpha", "beta", "gamma"]);
  });
});

test("a failed background call leaves the next one working", { timeout: 40000 }, async () => {
  // Race: the first evaluation throws in the page. The old client dropped the console and asked the watcher again, which sends no second form, so every later call waited out its timeout.
  let first = true;
  const firefox = addon_firefox((packet, fake, slots) => {
    if (first) {
      first = false;
      const resultID = "r-fail";
      fake.send({ from: packet.to, resultID });
      fake.send({ from: packet.to, type: "evaluationResult", resultID, exception: {}, exceptionMessage: "boom" });
      return;
    }
    answer_evaluation(packet, fake, slots);
  });
  await with_rdp(firefox, async (rdp, fake) => {
    await assert.rejects(evaluate_in_background(rdp, ADDON, `"first"`), /evaluation threw/);
    assert.equal(await evaluate_in_background(rdp, ADDON, `"second"`), "second");
    assert.equal(fake.sent.filter((packet) => packet.type === "watchTargets").length, 1);
  });
});

test("a multi-byte character split across two chunks arrives whole", async () => {
  await with_rdp(() => {}, async (rdp, fake) => {
    const reply = frame({ from: "actor1", answer: "café ☃ 😀" });
    const split_inside_snowman = reply.indexOf(Buffer.from("☃")) + 1;
    const pending = rdp.request("actor1", { type: "ask" });
    fake.send_bytes(reply.subarray(0, split_inside_snowman));
    await sleep(30);
    fake.send_bytes(reply.subarray(split_inside_snowman));
    assert.equal((await pending).answer, "café ☃ 😀");
  });
});

test("two packets in one chunk are both read", async () => {
  await with_rdp(() => {}, async (rdp, fake) => {
    const first = rdp.request("actor1", { type: "one" });
    const second = rdp.request("actor2", { type: "two" });
    fake.send_bytes(Buffer.concat([frame({ from: "actor1", answer: 1 }), frame({ from: "actor2", answer: 2 })]));
    assert.deepEqual([(await first).answer, (await second).answer], [1, 2]);
  });
});

test("a noSuchActor reply drops that page and the call retries on the next one", { timeout: 40000 }, async () => {
  // Race: the reload destroys the page and sends the new form while a call is in flight. Whichever arrives first, the retry must end on console2.
  const firefox = addon_firefox((packet, fake, slots) => {
    if (packet.to === "console1") {
      fake.send({ from: "console1", error: "noSuchActor", message: "no actor" });
      fake.send({ from: "watcher1", type: "target-destroyed-form", target: { actor: "target1" } });
      fake.send(background_form("target2", "console2"));
      return;
    }
    answer_evaluation(packet, fake, slots);
  });
  await with_rdp(firefox, async (rdp, fake) => {
    assert.equal(await evaluate_in_background(rdp, ADDON, `"after reload"`), "after reload");
    assert.equal(fake.sent.filter((packet) => packet.type === "watchTargets").length, 1);
    assert.ok(fake.sent.some((packet) => packet.to === "console2"));
  });
});

test("a request fails at once when the connection closes", async () => {
  await with_rdp(() => {}, async (rdp, fake) => {
    const pending = rdp.request("actor1", { type: "ask" });
    fake.close();
    await assert.rejects(pending, /connection to Firefox lost/);
    await assert.rejects(rdp.request("actor1", { type: "again" }), /connection to Firefox lost/);
  });
});

test("connecting fails at once when the socket closes before the greeting", async () => {
  const fake = await fake_server(() => {}, "closes");
  try {
    await assert.rejects(connect_rdp(fake.port), /lost before it greeted/);
  } finally {
    fake.close();
  }
});

test("connecting fails when the debugger never greets", async () => {
  const fake = await fake_server(() => {}, "stays silent");
  try {
    await assert.rejects(connect_rdp(fake.port, { request_timeout_ms: 100 }), /lost before it greeted \(no greeting\)/);
  } finally {
    fake.close();
  }
});

test("a noSuchActor reply followed by a late new form waits for that form", async () => {
  // Race: the page is gone and the reload's form is still on its way. The retry must wait for it, where the test above has it queued already.
  const firefox = addon_firefox((packet, fake, slots) => {
    if (packet.to === "console1") {
      fake.send({ from: "console1", error: "noSuchActor", message: "no actor" });
      fake.send({ from: "watcher1", type: "target-destroyed-form", target: { actor: "target1" } });
      setTimeout(() => fake.send(background_form("target2", "console2")), 50);
      return;
    }
    answer_evaluation(packet, fake, slots);
  });
  await with_rdp(firefox, async (rdp, fake) => {
    assert.equal(await evaluate_in_background(rdp, ADDON, `"after late reload"`), "after late reload");
    assert.ok(fake.sent.some((packet) => packet.to === "console2"));
  });
});

test("waiting for a new background page ends with the lost-connection error when the socket closes", async () => {
  const firefox = addon_firefox((packet, fake) => {
    fake.send({ from: packet.to, error: "noSuchActor", message: "no actor" });
    fake.send({ from: "watcher1", type: "target-destroyed-form", target: { actor: "target1" } });
    setTimeout(() => fake.close(), 50);
  });
  await with_rdp(firefox, async (rdp) => {
    await assert.rejects(evaluate_in_background(rdp, ADDON, `"never"`), /connection to Firefox lost .* while waiting for the background page/);
  });
});

test("a wait for a background page that starts on a closed socket fails at once with the lost-connection error", async () => {
  // Race: the socket closes before the wait starts, so the close hook never fires for it.
  const firefox = addon_firefox((packet, fake, slots) => answer_evaluation(packet, fake, slots));
  await with_rdp(firefox, async (rdp, fake) => {
    assert.equal(await evaluate_in_background(rdp, ADDON, `"warm up"`), "warm up");
    fake.send({ from: "watcher1", type: "target-destroyed-form", target: { actor: "target1" } });
    fake.close();
    while (!rdp.lost_reason()) await sleep(5);
    const started_at = Date.now();
    await assert.rejects(evaluate_in_background(rdp, ADDON, `"never"`), /connection to Firefox lost .* while waiting for the background page/);
    assert.ok(Date.now() - started_at < 2000);
  });
});

// A Firefox whose parent process hands out a new console actor on each getTarget. `dead` names consoles that answer noSuchActor.
function chrome_firefox(dead: Set<string> = new Set()) {
  const slots = new Map<string, string>();
  let targets = 0;
  return (packet: Packet, fake: Fake) => {
    if (packet.to === "root" && packet.type === "getProcess") fake.send({ from: "root", processDescriptor: { actor: "process1" } });
    else if (packet.to === "process1") fake.send({ from: "process1", process: { consoleActor: `chrome_console${++targets}` } });
    else if (dead.has(packet.to as string)) fake.send({ from: packet.to, error: "noSuchActor", message: "no actor" });
    else answer_evaluation(packet, fake, slots);
  };
}

test("repeated chrome calls ask for the parent-process target once", { timeout: 40000 }, async () => {
  await with_rdp(chrome_firefox(), async (rdp, fake) => {
    assert.equal(await evaluate_in_chrome(rdp, `"one"`), "one");
    assert.equal(await evaluate_in_chrome(rdp, `"two"`), "two");
    assert.equal(fake.sent.filter((packet) => packet.type === "getTarget").length, 1);
  });
});

test("a noSuchActor reply refreshes the parent-process console", { timeout: 40000 }, async () => {
  await with_rdp(chrome_firefox(new Set(["chrome_console1"])), async (rdp, fake) => {
    assert.equal(await evaluate_in_chrome(rdp, `"after refresh"`), "after refresh");
    assert.equal(fake.sent.filter((packet) => packet.type === "getTarget").length, 2);
    assert.ok(fake.sent.some((packet) => packet.to === "chrome_console2"));
  });
});

test("a silent root fails the connection at once, naming the debugger", async () => {
  await with_rdp(() => {}, async (rdp) => {
    await assert.rejects(rdp.request("root", { type: "getProcess", id: 0 }), /no answer from root/);
    await assert.rejects(rdp.request("actor1", { type: "ask" }), /Firefox stopped answering the debugger/);
  }, { request_timeout_ms: 100 });
});

test("a silent console with a silent root closes the connection", async () => {
  await with_rdp(() => {}, async (rdp) => {
    await assert.rejects(rdp.request("console1", { type: "ask" }), /no answer from console1/);
    await sleep(300);
    await assert.rejects(rdp.request("actor1", { type: "ask" }), /Firefox stopped answering the debugger/);
  }, { request_timeout_ms: 100 });
});

test("a silent console with a live root leaves the connection open", async () => {
  await with_rdp((packet, fake) => {
    if (packet.to === "root") fake.send({ from: "root", addonsActor: "addons1" });
  }, async (rdp) => {
    await assert.rejects(rdp.request("console1", { type: "ask" }), /no answer from console1/);
    await sleep(300);
    assert.equal(rdp.lost_reason(), undefined);
    assert.equal((await rdp.request("root", { type: "getRoot" })).addonsActor, "addons1");
  }, { request_timeout_ms: 100 });
});
