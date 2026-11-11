// The `media_quality` rule in one frame, driven against a fake player and a fake clock. The risks: a player that answers `unknown` until it plays, navigations that race an earlier poll, and a rule that fights a manual `media quality` choice.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RULE_GIVE_UP_MS, RULE_HOLD_MS, RULE_RECHECK_MS, create_rule } from "../../src/content/quality/rule.ts";
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
function setup(value: string | (() => Promise<string>), player = fake_player()) {
  const clock = { now: 0, sleeps: 0, on_sleep: (_sleeps: number): void => undefined };
  const rule = create_rule({
    read_value: typeof value === "string" ? async () => value : value,
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

test("min, a height between levels and auto each reach their level", async () => {
  for (const [value, wanted] of [["min", 360], ["900", 720], ["1080p", 1080], ["100", 360]] as const) {
    const { rule, player } = setup(value);
    await rule.start(true);
    assert.deepEqual(player.state.picks, wanted === 720 ? [] : [wanted], value);
    assert.equal(player.state.playing, wanted, value);
  }
  const { rule, player, clock } = setup("auto");
  await rule.start(true);
  assert.equal(player.state.autos, 1);
  assert.equal(clock.now, 0, "auto ends at one hand-back");
});

test("off leaves the player alone and never asks for the driver", async () => {
  const player = fake_player();
  let probes = 0;
  const rule = create_rule({ read_value: async () => "off", probe: () => (probes++, player.driver), sleep: async () => undefined, now: () => 0 });
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

test("a page with no player or one that never lists levels stops at the give-up time", async () => {
  const never = fake_player();
  never.state.listed = false;
  const { rule, clock } = setup("max", never);
  await rule.start(true);
  assert.equal(clock.now, RULE_GIVE_UP_MS);
  assert.deepEqual(never.state.picks, []);
  const absent = create_rule({ read_value: async () => "max", probe: () => undefined, sleep: async (ms) => void (absent_now += ms), now: () => absent_now });
  let absent_now = 0;
  await absent.start(true);
  assert.equal(absent_now, RULE_GIVE_UP_MS);
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
  const late = rule.start(false);
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

test("switching DesertFox off while the poll runs stops it, and an edited rule applies within the recheck time", async () => {
  const player = fake_player();
  player.state.listed = false;
  let value = "max";
  const { rule, clock } = setup(async () => value, player);
  clock.on_sleep = (sleeps) => {
    // The background answers `off` from sleep 5 on. The first recheck comes at sleep 10, and the player lists its levels only at sleep 12.
    if (sleeps === 5) value = "off";
    if (sleeps === 12) player.state.listed = true;
  };
  await rule.start(true);
  assert.deepEqual(player.state.picks, [], "the switch-off came before the poll could pick");
  assert.ok(clock.now <= RULE_RECHECK_MS + 100);
  const edited = setup(async () => value, fake_player());
  value = "max";
  edited.clock.on_sleep = (sleeps) => void (sleeps === 3 && (value = "min"));
  await edited.rule.start(true);
  assert.equal(edited.player.state.playing, 360);
});

test("a player that scripts build after the load-finish start still gets the rule, and a frame that never gets one stops at the deadline", async () => {
  // YouTube builds #movie_player by script after the load event, so a start with no player keeps polling.
  const player = fake_player();
  let present = false;
  const clock = { now: 0, sleeps: 0 };
  const rule = create_rule({
    read_value: async () => "max",
    probe: () => (present ? player.driver : undefined),
    sleep: async (ms) => {
      clock.now += ms;
      if (++clock.sleeps === 20) present = true;
    },
    now: () => clock.now,
  });
  await rule.start(false);
  assert.equal(player.state.playing, 1080);
  const never = setup("max", fake_player());
  never.player.state.listed = false;
  await never.rule.start(false);
  assert.equal(never.clock.now, RULE_GIVE_UP_MS);
});
