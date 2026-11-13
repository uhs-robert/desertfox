// The `media_quality` rule in one frame, driven against a fake player and a fake clock. The risks: a player that answers `unknown` until it plays, navigations that race an earlier poll, and a rule that fights a manual `media quality` choice.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RULE_BACKUP_MS, RULE_BACKUP_SPAN_MS, RULE_GIVE_UP_MS, RULE_HOLD_MS, RULE_INTERVAL_MS, create_rule } from "../../src/content/quality/rule.ts";
import { hls_driver } from "../../src/content/quality/hls.ts";
import type { Driver } from "../../src/content/quality/driver.ts";

// A player with levels 360, 720 and 1080. `listed` is false while it answers like YouTube's `unknown`. `reset_to` models a new video that starts at the site's own level.
function fake_player(playing = 720) {
  const state = { listed: true, playing, picks: [] as number[], autos: 0, video: "one" as string | undefined };
  const heights = [360, 720, 1080];
  const driver: Driver = {
    levels: () => (state.listed ? heights.map((height) => ({ height, label: `${height}p`, active: height === state.playing, pick: () => (state.picks.push(height), void (state.playing = height)) })) : []),
    auto: () => (state.listed ? (state.autos++, true) : false),
    video_id: () => state.video,
    skip: () => false,
  };
  return { state, driver };
}

// The clock moves only when the rule sleeps, so a test reads the time a poll took. `on_sleep` runs at each tick, where a test changes the page.
function setup(value: string | (() => Promise<string | undefined>), player = fake_player()) {
  const clock = { now: 0, sleeps: 0, on_sleep: (_sleeps: number): void => undefined };
  const rule = create_rule({
    report: typeof value === "string" ? async () => value : value,
    has_media: () => true,
    probe: () => player.driver,
    sleep: async (ms) => {
      clock.now += ms;
      clock.on_sleep(++clock.sleeps);
    },
    now: () => clock.now,
  });
  return { rule, clock, player };
}

test("a fresh load takes a player at another level to the rule's level, then watches until it held", async () => {
  const { rule, clock, player } = setup("max");
  await rule.start(false);
  assert.deepEqual(player.state.picks, [1080]);
  assert.equal(clock.now, RULE_HOLD_MS);
});

test("min and a height between levels each reach their level", async () => {
  for (const [value, wanted] of [["min", 360], ["900", 720], ["1080p", 1080], ["100", 360]] as const) {
    const { rule, player } = setup(value);
    await rule.start(true);
    assert.deepEqual(player.state.picks, wanted === 720 ? [] : [wanted], value);
    assert.equal(player.state.playing, wanted, value);
  }
});

test("auto leaves the player alone and does not reset a quality the user chose", async () => {
  const { rule, player, clock } = setup("auto");
  await rule.start(true);
  assert.equal(player.state.autos, 0);
  assert.deepEqual(player.state.picks, []);
  assert.equal(clock.now, 0);
});

test("a row auto under a global max leaves a player the user set to 360 at 360, on load and on navigation", async () => {
  const { rule, player } = setup("auto", fake_player(360));
  await rule.start(false);
  await rule.start(true);
  assert.deepEqual(player.state.picks, []);
  assert.equal(player.state.autos, 0);
  assert.equal(player.state.playing, 360);
});

test("off leaves the player alone and never asks for the driver", async () => {
  const player = fake_player();
  let probes = 0;
  const rule = create_rule({ report: async () => "off", has_media: () => true, probe: () => (probes++, player.driver), sleep: async () => undefined, now: () => 0 });
  await rule.start(true);
  assert.equal(probes, 0);
  assert.deepEqual(player.state.picks, []);
});

test("a player that answers unknown until it plays is retried every 100 ms and set once it lists levels", async () => {
  const player = fake_player();
  player.state.listed = false;
  const { rule, clock } = setup("max", player);
  clock.on_sleep = (sleeps) => void (player.state.listed = sleeps === 7);
  await rule.start(true);
  assert.equal(player.state.picks.length, 1);
  assert.equal(player.state.playing, 1080);
  assert.ok(clock.sleeps >= 7);
});

test("a player that never lists levels polls to the give-up time", async () => {
  const never = fake_player();
  never.state.listed = false;
  const { rule, clock } = setup("max", never);
  await rule.start(true);
  assert.equal(clock.now, RULE_GIVE_UP_MS);
  assert.deepEqual(never.state.picks, []);
});

test("a player that throws on a read counts as not ready, and the poll goes on", async () => {
  const player = fake_player();
  let throwing = true;
  const { levels } = player.driver;
  player.driver.levels = () => {
    if (throwing) throw new Error("page object trap");
    return levels();
  };
  const { rule, clock } = setup("max", player);
  clock.on_sleep = (sleeps) => void (throwing = sleeps < 3);
  await rule.start(true);
  assert.equal(player.state.playing, 1080);
});

test("a new video that starts at the site's own level after the old one held is taken up again", async () => {
  const { rule, clock, player } = setup("max", fake_player(1080));
  // An in-site navigation: the address changed while the old video still sits at the rule's level. The next video loads 1.2 s later and starts low.
  clock.on_sleep = (sleeps) => void (sleeps === 12 && ((player.state.playing = 360), (player.state.video = "two")));
  await rule.start(true);
  assert.deepEqual(player.state.picks, [1080]);
  assert.equal(player.state.playing, 1080);
});

test("a second navigation replaces the poll of the first, and the first sets nothing more", async () => {
  const { rule, clock, player } = setup("max");
  const first = rule.start(false);
  // The first poll is asleep at its first tick. The second start takes over before it wakes.
  clock.on_sleep = (sleeps) => {
    if (sleeps === 1) {
      void rule.start(false);
      // The player now belongs to the newest video, which starts low again.
      player.state.playing = 360;
    }
  };
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(player.state.playing, 1080);
  // One poll ran after the replacement. Two polls would have slept about twice as often.
  assert.ok(clock.sleeps <= 1 + RULE_HOLD_MS / 100 + 1, `${clock.sleeps} sleeps`);
});

test("a start whose rule read answers after a newer start never runs", async () => {
  const release: ((value: string) => void)[] = [];
  let answered = "max";
  const { rule, player } = setup(() => (release.length < 2 ? new Promise<string>((resolve) => release.push(resolve)) : Promise.resolve(answered)));
  const early = rule.start(false);
  const late = rule.start(true);
  // The newer read answers first, then the older one answers with a stale value.
  release[1]!("min");
  answered = "min";
  await late;
  release[0]!("max");
  await early;
  assert.equal(player.state.playing, 360);
  assert.deepEqual(player.state.picks, [360]);
});

test("a navigation while the rule is being read still applies the newest rule only", async () => {
  const release: ((value: string) => void)[] = [];
  let answered = "max";
  const { rule, player } = setup(() => (release.length < 2 ? new Promise<string>((resolve) => release.push(resolve)) : Promise.resolve(answered)));
  const first = rule.start(false);
  release[0]!("off");
  await first;
  const second = rule.start(false);
  release[1]!("max");
  answered = "max";
  await second;
  assert.equal(player.state.playing, 1080);
});

test("a manual choice ends the poll and stands over a finished load, until the next navigation", async () => {
  const { rule, clock, player } = setup("max");
  const polling = rule.start(true);
  clock.on_sleep = (sleeps) => {
    if (sleeps === 1) {
      // The user runs `media quality min`, which the bundle reports before it applies.
      rule.manual_choice();
      player.state.playing = 360;
    }
  };
  await polling;
  assert.equal(player.state.playing, 360, "the poll must not undo the choice");
  // The load finishing is not a navigation, so the choice stands.
  clock.on_sleep = () => undefined;
  await rule.start(false);
  assert.equal(player.state.playing, 360);
  // The next navigation applies the rule again.
  await rule.start(true);
  assert.equal(player.state.playing, 1080);
});

test("a finished load starts the rule when no manual choice was made", async () => {
  const { rule, player } = setup("max");
  await rule.start(false);
  assert.equal(player.state.playing, 1080);
});

test("a navigation whose new video loads after the old one would have held is still taken to the level", async () => {
  // The old video sits at max, so a fixed watch would end after 3 s. The new video (an ad, or a slow start) appears at 5 s, starts low and has a new identity.
  const { rule, clock, player } = setup("max", fake_player(1080));
  clock.on_sleep = (sleeps) => void (sleeps === 50 && ((player.state.playing = 360), (player.state.video = "two")));
  await rule.start(true);
  assert.equal(player.state.playing, 1080);
  assert.deepEqual(player.state.picks, [1080]);
});

test("a navigation to the same video runs to the deadline, a hard load that holds ends after the hold", async () => {
  const same = setup("max", fake_player(1080));
  await same.rule.start(true);
  assert.equal(same.clock.now, RULE_GIVE_UP_MS);
  const load = setup("max", fake_player(1080));
  await load.rule.start(false);
  assert.equal(load.clock.now, RULE_HOLD_MS - 100);
});

test("a player with no video identity keeps the fixed watch", async () => {
  const player = fake_player(1080);
  player.state.video = undefined;
  const { rule, clock } = setup("max", player);
  await rule.start(true);
  assert.equal(clock.now, RULE_HOLD_MS - 100);
});

test("a settings change reaches a running poll: off stops it, and an edited rule applies at once", async () => {
  const player = fake_player();
  player.state.listed = false;
  let value = "max";
  const { rule, clock } = setup(async () => value, player);
  clock.on_sleep = (sleeps) => {
    // The settings change reaches the frame at sleep 5. The player lists its levels only at sleep 12.
    if (sleeps === 5) {
      value = "off";
      void rule.refresh();
    }
    if (sleeps === 12) player.state.listed = true;
  };
  await rule.start(true);
  assert.deepEqual(player.state.picks, [], "the switch-off came before the poll could pick");
  assert.ok(clock.now < RULE_GIVE_UP_MS);
  value = "max";
  const edited = setup(async () => value, fake_player());
  edited.clock.on_sleep = (sleeps) => {
    if (sleeps === 3) {
      value = "min";
      void edited.rule.refresh();
    }
  };
  await edited.rule.start(true);
  assert.equal(edited.player.state.playing, 360);
});

test("a player that scripts build after the load-finish start still gets the rule", async () => {
  // YouTube builds #movie_player by script after the load event, so a start with no player keeps polling.
  const player = fake_player();
  let present = false;
  const clock = { now: 0, sleeps: 0 };
  const rule = create_rule({
    report: async () => "max",
    has_media: () => true,
    probe: () => (present ? player.driver : undefined),
    sleep: async (ms) => {
      clock.now += ms;
      if (++clock.sleeps === 20) present = true;
    },
    now: () => clock.now,
  });
  await rule.start(false);
  assert.equal(player.state.playing, 1080);
});

test("a rule poll on an hls.js player that has buffered nothing writes the level once", async () => {
  const writes: string[] = [];
  const hls = { levels: [{ height: 360 }, { height: 720 }], loadLevel: 0 };
  // currentLevel reads -1 until a fragment is buffered, and each write to it flushes the buffer.
  Object.defineProperty(hls, "currentLevel", { get: () => -1, set: () => void writes.push("current") });
  Object.defineProperty(hls, "nextLevel", { get: () => hls.loadLevel, set: (value: number) => void (writes.push("next"), (hls.loadLevel = value)) });
  const driver = hls_driver({ html5player: { hlsobj: hls } })!;
  const { rule } = setup("max", { state: fake_player().state, driver });
  await rule.start(false);
  assert.deepEqual(writes, ["next"]);
});

test("a start that is not a navigation leaves the running poll in place and only moves its level", async () => {
  let reports = 0;
  let value = "max";
  const { rule, clock, player } = setup(() => (reports++, Promise.resolve(value)));
  const running = rule.start(false);
  value = "min";
  clock.on_sleep = (sleeps) => void (sleeps === 1 && void rule.start(false));
  await running;
  assert.equal(reports, 2);
  assert.equal(player.state.playing, 360);
  assert.ok(clock.sleeps < RULE_GIVE_UP_MS / RULE_INTERVAL_MS, "a second poll would have run on");
});

// A clock that moves only when the test ticks it, so a timer that must not run shows as a missing tick.
function manual_clock() {
  const waiting: { ms: number; wake: () => void }[] = [];
  const clock = {
    now: 0,
    sleep: (ms: number) => new Promise<void>((wake) => waiting.push({ ms, wake })),
    waiting: () => waiting.length,
    async tick(): Promise<void> {
      const next = waiting.shift();
      if (!next) return;
      clock.now += next.ms;
      next.wake();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  return clock;
}

// Ticks until no timer waits, which ends a poll and a look-again loop alike.
async function run_out(clock: ReturnType<typeof manual_clock>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let guard = 0; clock.waiting() > 0 && guard < 500; guard++) await clock.tick();
}

// A frame with no video until `appear` runs. `reports` counts what the frame sent to the background.
function idle_frame(value = "max") {
  const player = fake_player();
  const clock = manual_clock();
  const frame = { video: false, probes: 0, reports: 0, media_checks: 0, value };
  const rule = create_rule({
    report: async () => (frame.reports++, frame.video ? frame.value : undefined),
    has_media: () => (frame.media_checks++, frame.video),
    probe: () => (frame.probes++, frame.video ? player.driver : undefined),
    sleep: clock.sleep,
    now: () => clock.now,
  });
  return { rule, clock, frame, player };
}

test("a frame with no video reports once, probes nothing and starts no poll", async () => {
  const { rule, frame, clock } = idle_frame();
  await rule.start(true);
  assert.equal(frame.reports, 1);
  assert.equal(frame.probes, 0);
  assert.equal(clock.now, 0);
  assert.equal(clock.waiting(), 1, "only the slow look-again timer waits");
});

test("a media event wakes a frame that had no video: one more report, then the poll with the reply value", async () => {
  const { rule, frame, player, clock } = idle_frame("min");
  await rule.start(true);
  frame.video = true;
  rule.wake();
  rule.wake();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(frame.reports, 2, "the second event came while the first report was in flight");
  while (clock.waiting() > 0 && player.state.playing !== 360) await clock.tick();
  assert.equal(player.state.playing, 360);
});

test("a media event after the frame got its rule changes nothing, so a play after a pause cannot undo a choice from the site's menu", async () => {
  const { rule, frame, clock } = idle_frame();
  frame.video = true;
  void rule.start(true);
  await run_out(clock);
  rule.wake();
  await run_out(clock);
  assert.equal(frame.reports, 1);
});

test("the look-again check finds a video that appears 4 s after the run, with one report only when it hits", async () => {
  const { rule, frame, clock, player } = idle_frame();
  await rule.start(true);
  await clock.tick();
  assert.equal(frame.reports, 1, "the 2 s look found nothing and sent nothing");
  frame.video = true;
  await clock.tick();
  assert.equal(frame.reports, 2);
  while (clock.waiting() > 0 && player.state.playing !== 1080) await clock.tick();
  assert.equal(player.state.playing, 1080);
});

test("the look-again check ends on schedule at 10 s, and a later video is not found by it", async () => {
  const { rule, frame, clock } = idle_frame();
  await rule.start(true);
  for (let waited = 0; waited < RULE_BACKUP_SPAN_MS; waited += RULE_BACKUP_MS) await clock.tick();
  assert.equal(clock.now, RULE_BACKUP_SPAN_MS);
  assert.equal(clock.waiting(), 0, "no timer is left");
  const checks = frame.media_checks;
  frame.video = true;
  await clock.tick();
  assert.equal(frame.media_checks, checks);
  assert.equal(frame.reports, 1);
});

test("a second run of the bundle in a frame that had no video leaves one look-again timer, not two", async () => {
  const { rule, frame, clock } = idle_frame();
  await rule.start(true);
  await rule.start(false);
  assert.equal(frame.reports, 2);
  assert.equal(clock.waiting(), 1);
  await clock.tick();
  assert.equal(frame.media_checks, 1);
  assert.equal(clock.waiting(), 1);
});

test("a second run on a frame that already got its rule and finished does not poll again while a manual choice stands", async () => {
  const { rule, frame, player, clock } = idle_frame();
  frame.video = true;
  void rule.start(true);
  await run_out(clock);
  rule.manual_choice();
  player.state.playing = 360;
  void rule.start(false);
  await run_out(clock);
  assert.equal(frame.reports, 2, "the about:blank pass reports again");
  assert.equal(player.state.playing, 360);
});

test("a settings change reaches a frame with a video even after its poll ended, and an unchanged rule starts nothing", async () => {
  const { rule, frame, player, clock } = idle_frame();
  frame.video = true;
  player.state.playing = 1080;
  void rule.start(false);
  await run_out(clock);
  void rule.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(frame.reports, 2);
  assert.equal(clock.waiting(), 0, "the same rule starts no poll");
  frame.value = "min";
  void rule.refresh();
  await run_out(clock);
  assert.equal(player.state.playing, 360);
});

test("a settings change reaches an idle frame with no video only through its next report", async () => {
  const { rule, frame, player, clock } = idle_frame();
  await rule.start(true);
  frame.value = "min";
  await rule.refresh();
  assert.equal(frame.reports, 1, "a frame with no video sends nothing on a settings change");
  frame.video = true;
  rule.wake();
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (player.state.playing !== 360 && clock.waiting() > 0) await clock.tick();
  assert.equal(player.state.playing, 360);
});

test("a run that is not a navigation, in a frame that already has a rule, only reports: a level chosen in the site's menu stays", async () => {
  const { rule, frame, player, clock } = idle_frame();
  frame.video = true;
  void rule.start(true);
  await run_out(clock);
  assert.equal(player.state.playing, 1080);
  // The user picks 720p in the site's own menu. A media command then injects the bundle again.
  player.state.playing = 720;
  const picks = player.state.picks.length;
  void rule.start(false);
  await run_out(clock);
  assert.equal(frame.reports, 2);
  assert.equal(player.state.picks.length, picks, "the rule set a level again");
  assert.equal(player.state.playing, 720);
});

test("a manual choice drops a report still waiting for its answer, so a late reply neither clears the choice nor starts a poll", async () => {
  const release: ((value: string) => void)[] = [];
  const player = fake_player(480);
  const clock = manual_clock();
  const rule = create_rule({ report: () => new Promise<string>((resolve) => release.push(resolve)), has_media: () => true, probe: () => player.driver, sleep: clock.sleep, now: () => clock.now });
  const first = rule.start(true);
  // `media quality 480` injected the bundle, and its request won the race against the report.
  rule.manual_choice();
  release[0]!("max");
  await first;
  await run_out(clock);
  assert.deepEqual(player.state.picks, []);
  assert.equal(player.state.playing, 480);
  // The frame stays manual: a later media event reports again, and still starts nothing.
  rule.wake();
  release[1]!("max");
  await run_out(clock);
  assert.deepEqual(player.state.picks, []);
});

test("a navigation that finds no video keeps its end of a manual choice, so the next video gets the rule", async () => {
  const { rule, frame, player, clock } = idle_frame();
  frame.video = true;
  void rule.start(true);
  await run_out(clock);
  rule.manual_choice();
  player.state.playing = 480;
  // An in-site navigation: the site removes its video for a moment.
  frame.video = false;
  await rule.start(true);
  frame.video = true;
  player.state.playing = 720;
  rule.wake();
  await run_out(clock);
  assert.equal(player.state.playing, 1080, "the new video was not taken to the rule's level");
});

test("a navigation that finds no video ends the old poll and the old rule, so a new player gets the new address's rule", async () => {
  const { rule, frame, player, clock } = idle_frame("max");
  frame.video = true;
  player.state.listed = false;
  void rule.start(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(clock.waiting(), 1, "the poll waits for a player that lists levels");
  // The site navigates and drops its video. The new address has another rule.
  frame.video = false;
  frame.value = "min";
  await rule.start(true);
  // The new player appears while the old poll's timer is still pending.
  frame.video = true;
  player.state.listed = true;
  await clock.tick();
  assert.deepEqual(player.state.picks, [], "the old poll set a level with the old rule");
  rule.wake();
  await run_out(clock);
  assert.equal(player.state.playing, 360, "the new video got the new rule");
});
