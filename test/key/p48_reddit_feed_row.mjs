// The shipped reddit row on a test address with the site pattern swapped: j and k walk the posts of a feed, skip an ad post and reach the later posts inside faceplate-batch, G goes to the last post, gg stays the plain scroll to the top, and a thread page with no shreddit-feed keeps j as scroll.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect }) {
  await setup("load the shipped reddit row for the reddit_ pages", async () => {
    const dir = config_copy();
    const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === "reddit").row;
    const lines = ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=reddit_*"', ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`), ""];
    appendFileSync(join(dir, "settings.toml"), lines.join("\n"));
    await load_config_dir(dir);
  });

  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);

  // Reddit's feed: posts in articles, then an ad post, then a later page whose posts sit in faceplate-batch.
  const post = (id) => `<article><shreddit-post style="display:block;height:60px;margin-bottom:40px"><a slot="full-post-link" id="${id}" href="#${id}" style="display:block;height:60px">post ${id}</a></shreddit-post></article>`;
  const open_feed = async (id) => {
    await open_page("controls", `reddit_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const feed = document.createElement("shreddit-feed");
      feed.innerHTML = ${JSON.stringify(post("p0") + post("p1") + '<shreddit-ad-post class="promotedlink" style="display:block;height:60px;margin-bottom:40px"><a slot="full-post-link" id="ad" href="#ad">ad</a></shreddit-ad-post>' + post("p2") + '<faceplate-batch>' + post("p3") + post("p4") + '</faceplate-batch>')};
      document.body.prepend(feed);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };

  await run_case("j and k walk the posts, skip the ad and reach the posts inside faceplate-batch", async () => {
    await open_feed("walk");
    await press_keys("jjj");
    await expect_focus("p2");
    await press_keys("jj");
    await expect_focus("p4");
    await press_keys("k");
    await expect_focus("p3");
    await press_keys("kk");
    await expect_focus("p1");
  });

  await run_case("G goes to the last post and gg scrolls to the top without focusing a post", async () => {
    await open_feed("ends");
    await press_keys("G");
    await expect_focus("p4");
    await in_active_tab("window.scrollTo(0, 400); 0");
    await poll_until("the page to scroll down", async () => (await in_active_tab("scrollY")) === 400);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
    expect((await focused()) !== "p0", "gg focused the first post");
  });

  await run_case("on a thread page with no shreddit-feed, j scrolls", async () => {
    await open_page("controls", "reddit_thread", { new_tab: true });
    await in_active_tab(`(() => {
      const post = document.createElement("shreddit-post");
      post.innerHTML = '<a slot="full-post-link" id="solo" href="#solo">the thread</a>';
      document.body.prepend(post);
      document.activeElement?.blur();
      return true;
    })()`);
    await press_keys("j");
    await poll_until("j to scroll the page", async () => (await in_active_tab("scrollY")) > 0);
    expect((await focused()) !== "solo", "j focused the thread post");
  });
}
