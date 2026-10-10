const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../extension/data.js");
const extension = path.resolve(__dirname, "../extension");

test("extract nested old/new X user shapes, including zero, without mixing users", () => {
  const payload = { data: { entries: [
    { item: { user_results: { result: { __typename: "User", rest_id: "1", legacy: { screen_name: "Lauren", followers_count: 174000 } } } } },
    { core: { screen_name: "Tim" }, legacy: { followers_count: 11000 } },
    { result: { core: { screen_name: "Zero" }, legacy: { followers_count: 0, fast_followers_count: 98 } } },
    { screen_name: "Metrics", public_metrics: { followers_count: 20 } },
    { core: { screen_name: "NoCount" }, legacy: { friends_count: 999 } },
    { screen_name: "Separate", sibling: { followers_count: 42 } },
    { screen_name: "Bad", followers_count: -1 },
    { screen_name: "BadString", followers_count: "42" }
  ] } };
  const users = Object.fromEntries(data.extractUsers(payload).filter(user => user.followersCount !== undefined).map(user => [user.screenName, user.followersCount]));
  assert.deepEqual(users, { metrics: 20, zero: 0, tim: 11000, lauren: 174000 });
});

test("cycles, invalid identities, duplicates and partial users are safe", () => {
  const user = { core: { screen_name: "MixedCase" }, legacy: { followers_count: 7 } };
  user.self = user;
  const results = data.extractUsers([user, user, { screen_name: "<script>", followers_count: 10 }]);
  assert.deepEqual(results, [{ screenName: "mixedcase", followersCount: 7 }]);
  assert.equal(data.normalizeUser({ screenName: "a", followersCount: NaN }), null);
  assert.equal(data.normalizeUser({ screenName: "a", followersCount: Number.MAX_SAFE_INTEGER + 1 }), null);
});

test("current X relationship_counts layout uses total followers, including zero", () => {
  // Minimal anonymized shape observed in the user's actual HomeTimeline response.
  const payload = { data: { entries: [
    { result: { __typename: "User", core: { screen_name: "CurrentUser" }, relationship_counts: { followers: 48495, following: 3866 } } },
    { result: { __typename: "User", core: { screen_name: "CurrentZero" }, relationship_counts: { followers: 0, following: 99 } } },
    { result: { __typename: "User", core: { screen_name: "FollowingOnly" }, relationship_counts: { following: 123 } } }
  ] } };
  const users = Object.fromEntries(data.extractUsers(payload).filter(user => user.followersCount !== undefined).map(user => [user.screenName, user.followersCount]));
  assert.deepEqual(users, { currentzero: 0, currentuser: 48495 });
});

test("Chinese compact display and zero are accurate", () => {
  for (const [count, text] of [[0, "0"], [423, "423"], [1574, "1,574"], [9999, "9,999"], [10000, "1万"], [11000, "1.1万"], [174000, "17.4万"], [100000000, "1亿"]]) {
    assert.equal(data.formatCount(count), text);
  }
});

test("only X API responses are inspected", () => {
  for (const url of ["/i/api/graphql/abc/HomeTimeline", "https://api.x.com/1.1/users/show.json"]) assert.equal(data.isApiUrl(url, "https://x.com/home"), true);
  for (const url of ["https://evilx.com/i/api/test", "https://x.com.evil.test/i/api/test", "/settings", "https://twitter.com/i/api/2/test", "/i/api/graphql/abc/DmInbox", "/i/api/graphql/abc/CreateTweet", "http://x.com/i/api/test", "https://example.com/i/api/graphql/abc"]) assert.equal(data.isApiUrl(url, "https://x.com/home"), false);
});

test("recommendation and profile reading responses deliver user data from a cold cache", async () => {
  for (const operation of ["ExplorePage", "ConnectTabTimeline", "UserOriginalsTimeline", "UserRepliesTimeline", "UserRepostsTimeline", "UserArticlesTweets", "Bookmarks", "Likes"]) {
    for (const method of ["GET", "POST"]) {
      const payload = { data: { entries: [{ user_results: { result: {
        rest_id: "123", core: { screen_name: "ListUser", created_at: "2023-11-15T14:05:45Z" },
        relationship_counts: { followers: 417, following: 80 },
        relationship_perspectives: { following: true, followed_by: false }
      } } }] } };
      let calls = 0;
      const response = new Response(JSON.stringify(payload));
      const harness = bridgeHarness(() => { calls++; return Promise.resolve(response); });
      const delivered = await harness.window.fetch(`/i/api/graphql/test/${operation}`, { method });
      await waitFor(() => harness.posts.some(message => message.type === "users"));
      assert.equal(calls, 1);
      assert.deepEqual(await delivered.json(), payload);
      const user = harness.posts.find(message => message.type === "users").users[0];
      assert.equal(user.screenName, "listuser");
      assert.equal(user.followersCount, 417);
      assert.equal(user.following, true);
      assert.equal(user.createdAt, Date.parse("2023-11-15T14:05:45Z"));
    }
  }
});

function bridgeHarness(fetch, extra = {}) {
  const posts = [];
  const listeners = new Map();
  class XHR {
    constructor() { this.events = new Map(); this.status = 200; this.responseType = ""; }
    open(method, url) { this.url = url; }
    send() { return "original-send-result"; }
    addEventListener(type, listener, options) { this.events.set(type, { listener, options }); }
    finish(payload, type = "") {
      this.responseType = type;
      this.response = payload;
      this.responseText = typeof payload === "string" ? payload : JSON.stringify(payload);
      this.events.get("loadend")?.listener();
      this.events.delete("loadend");
    }
  }
  const window = {
    fetch,
    addEventListener: (type, listener) => listeners.set(type, listener),
    postMessage: message => posts.push(message)
  };
  const context = vm.createContext({ window, location: { origin: "https://x.com", href: "https://x.com/home" }, XMLHttpRequest: XHR, URL, __xfcData: data, ...extra });
  vm.runInContext(fs.readFileSync(path.join(extension, "network.js"), "utf8"), context);
  return { window, XHR, posts, listeners };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for bridge data");
}

test("Fetch preserves the original promise/body and performs no extra request", async () => {
  let calls = 0;
  const response = new Response(JSON.stringify({ core: { screen_name: "Alice" }, legacy: { followers_count: 12345 } }));
  const promise = Promise.resolve(response);
  const harness = bridgeHarness(() => { calls++; return promise; });
  const returned = harness.window.fetch("/i/api/graphql/test/HomeTimeline");
  assert.equal(returned, promise);
  const delivered = await returned;
  assert.equal(delivered, response);
  assert.deepEqual(await delivered.json(), { core: { screen_name: "Alice" }, legacy: { followers_count: 12345 } });
  await waitFor(() => harness.posts.some(message => message.type === "users"));
  assert.equal(calls, 1);
  assert.equal(harness.posts.find(message => message.type === "users").users[0].followersCount, 12345);
});

test("Fetch errors and non-JSON bodies do not create counts or change rejection", async () => {
  const error = new Error("network failed");
  const rejected = Promise.reject(error);
  const harness = bridgeHarness(() => rejected);
  assert.equal(harness.window.fetch("/i/api/graphql/test/HomeTimeline"), rejected);
  await assert.rejects(rejected, value => value === error);
  await settle();
  assert.equal(harness.posts.filter(message => message.type === "users").length, 0);
  const invalid = bridgeHarness(() => Promise.resolve(new Response("not json")));
  await invalid.window.fetch("/i/api/graphql/test/HomeTimeline");
  await settle();
  assert.equal(invalid.posts.filter(message => message.type === "users").length, 0);
});

test("XHR supports JSON/text, zero, reuse and ignores failed responses", () => {
  const harness = bridgeHarness(() => Promise.resolve());
  const xhr = new harness.XHR();
  xhr.open("GET", "/i/api/graphql/test/Followers");
  assert.equal(xhr.send(), "original-send-result");
  xhr.finish({ legacy: { screen_name: "alice", followers_count: 0 } }, "json");
  xhr.open("GET", "/i/api/graphql/test/Followers");
  xhr.send();
  xhr.finish({ legacy: { screen_name: "alice", followers_count: 7 } });
  xhr.open("GET", "/i/api/graphql/test/Followers");
  xhr.send();
  xhr.status = 429;
  xhr.finish({ legacy: { screen_name: "alice", followers_count: 99 } });
  assert.deepEqual(harness.posts.filter(message => message.type === "users").map(message => message.users[0].followersCount), [0, 7]);
});

test("bridge replays early counts and rejects messages from other sources", () => {
  const harness = bridgeHarness(() => Promise.resolve());
  const xhr = new harness.XHR();
  xhr.open("GET", "/i/api/graphql/test/Followers");
  xhr.send();
  xhr.finish({ legacy: { screen_name: "Alice", followers_count: 25 } });
  const before = harness.posts.length;
  harness.listeners.get("message")({ source: {}, origin: "https://x.com", data: { channel: data.channel, type: "ready" } });
  assert.equal(harness.posts.length, before);
  harness.listeners.get("message")({ source: harness.window, origin: "https://x.com", data: { channel: data.channel, type: "ready" } });
  assert.equal(harness.posts.length, before + 2);
  assert.equal(harness.posts.at(-1).users[0].screenName, "alice");
});

test("manifest restricts injection to X and contains only existing local files", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json")));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.background, {service_worker: "background.js"});
  assert.equal(fs.existsSync(path.join(extension, manifest.background.service_worker)), true);
  assert.equal(fs.existsSync(path.join(extension, manifest.action.default_popup)), true);
  for (const script of manifest.content_scripts) {
    assert.equal(script.run_at, "document_start");
    for (const name of [...script.js, ...(script.css ?? [])]) assert.equal(fs.existsSync(path.join(extension, name)), true);
    assert.deepEqual(script.matches, ["https://x.com/*", "https://www.x.com/*", "https://twitter.com/*", "https://www.twitter.com/*"]);
  }
});


test("extract current and legacy relations/date independently of follower count", () => {
  const iso = "2026-10-08T03:12:33Z";
  const users = Object.fromEntries(data.extractUsers([
    { core: { screen_name: "Modern", created_at: "Thu Oct 08 03:12:33 +0000 2026" }, relationship_perspectives: { following: true, followed_by: false } },
    { legacy: { screen_name: "Legacy", following: false, followed_by: true, created_at: iso, followers_count: 0 } },
    { core: { screen_name: "Partial" }, relationship_perspectives: { followed_by: true } },
    { core: { screen_name: "Invalid", created_at: "2026-02-30T03:12:33Z" }, relationship_perspectives: { following: "false", followed_by: 1 } },
    { core: { screen_name: "NoDate", created_at: "1" } },
    { screen_name: "Separate", sibling: { following: true, created_at: iso } }
  ]).map(user => [user.screenName, user]));
  assert.deepEqual(users, {
    partial: { screenName: "partial", followedBy: true },
    legacy: { screenName: "legacy", followersCount: 0, following: false, followedBy: true, createdAt: Date.parse(iso) },
    modern: { screenName: "modern", following: true, followedBy: false, createdAt: Date.parse(iso) }
  });
});

test("new account requires a valid past date strictly younger than 90 days", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  const window = 90 * 86400000;
  for (const value of [now, now - window + 1]) assert.equal(data.isNewAccount(value, now), true);
  for (const value of [now - window, now - window - 1, now + 1, undefined, null, NaN, "2026-10-09", -1]) assert.equal(data.isNewAccount(value, now), false);
});

test("bridge updates relation-only changes and retains known fields in partial responses", () => {
  const harness = bridgeHarness(() => Promise.resolve());
  const xhr = new harness.XHR();
  const deliver = payload => {
    xhr.open("GET", "/i/api/graphql/test/UserByScreenName");
    xhr.send(); xhr.finish(payload, "json");
  };
  deliver({ core: { screen_name: "Alice", created_at: "2026-10-08T03:12:33Z" }, relationship_counts: { followers: 25 }, relationship_perspectives: { following: true, followed_by: true } });
  deliver({ core: { screen_name: "Alice" }, relationship_perspectives: { following: false } });
  deliver({ core: { screen_name: "Alice" }, relationship_counts: { followers: 25 } });
  const updates = harness.posts.filter(message => message.type === "users");
  assert.equal(updates.length, 2);
  assert.deepEqual({ ...updates.at(-1).users[0] }, { screenName: "alice", followersCount: 25, following: false, followedBy: true, createdAt: Date.parse("2026-10-08T03:12:33Z") });
});


test("viewer changes reset caches and discard responses started for the previous viewer", async () => {
  let callback;
  const button = { textContent: "Viewer @First" };
  const extra = {
    document: { body: {}, querySelector: () => button },
    MutationObserver: class { constructor(fn) { callback = fn; } observe() {} }
  };
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const harness = bridgeHarness(() => pending, extra);
  const xhr = new harness.XHR();
  xhr.open("GET", "/i/api/graphql/test/UserByScreenName"); xhr.send();
  xhr.finish({ core: { screen_name: "Alice" }, relationship_perspectives: { following: true } }, "json");
  harness.window.fetch("/i/api/graphql/test/HomeTimeline");
  button.textContent = "Viewer @Second";
  callback();
  assert.equal(harness.posts.at(-1).type, "reset");
  complete(new Response(JSON.stringify({ core: { screen_name: "Late" }, relationship_perspectives: { followed_by: true } })));
  await settle(); await settle();
  assert.equal(harness.posts.filter(message => message.type === "users").length, 1);
  harness.listeners.get("message")({ source: harness.window, origin: "https://x.com", data: { channel: data.channel, type: "ready" } });
  assert.equal(harness.posts.filter(message => message.type === "users").length, 1);
  xhr.open("GET", "/i/api/graphql/test/UserByScreenName"); xhr.send();
  xhr.finish({ core: { screen_name: "Alice" }, relationship_perspectives: { following: false } }, "json");
  assert.equal(harness.posts.at(-1).users[0].following, false);
});


test("account age shows completed UTC years/months and handles month-end anniversaries", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  for (const [created, label] of [
    ["2026-10-09T12:00:00Z", "新号"],
    ["2026-02-10T12:00:00Z", "8个月"],
    ["2023-02-10T12:00:00Z", "3年8个月"],
    ["2023-10-10T12:00:00Z", "3年"],
    ["2023-10-10T12:00:01Z", "2年11个月"],
    ["2026-10-11T12:00:00Z", null]
  ]) assert.equal(data.formatAccountAge(Date.parse(created), now), label);
  assert.equal(data.formatAccountAge(now - 90*86400000 + 1, now), "新号");
  assert.notEqual(data.formatAccountAge(now - 90*86400000, now), "新号");
  assert.equal(data.formatAccountAge(Date.parse("2025-10-31T12:00:00Z"), Date.parse("2026-02-28T12:00:00Z")), "4个月");
  assert.equal(data.formatAccountAge(Date.parse("2024-02-29T12:00:00Z"), Date.parse("2025-02-28T12:00:00Z")), "1年");
  for (const invalid of [undefined, null, NaN, -1, "2023-10-10"]) assert.equal(data.formatAccountAge(invalid, now), null);
});


test("private endpoints, write operations and unsupported verbs are never cloned or parsed", async () => {
  let clones = 0;
  const harness = bridgeHarness(() => Promise.resolve({ok:true,clone(){clones++;throw new Error("must not inspect");}}));
  await harness.window.fetch("/i/api/graphql/test/DmInbox");
  await harness.window.fetch("/i/api/graphql/test/CreateTweet", {method:"POST"});
  await harness.window.fetch({url:"https://x.com/i/api/graphql/test/Followers",method:"DELETE"});
  const xhr=new harness.XHR();xhr.open("POST","/i/api/graphql/test/CreateTweet");xhr.send();
  assert.equal(xhr.events.size,0);
  await settle();assert.equal(clones,0);
});


test("X read queries accept POST as well as GET without reading request bodies",async()=>{
 const url="https://x.com/i/api/graphql/test/HomeTimeline";
 const payload={rest_id:"1",core:{screen_name:"Alice"},relationship_counts:{followers:100}};
 for(const input of [url,{url,method:"POST"}]) {
  const response=new Response(JSON.stringify(payload));const promise=Promise.resolve(response);let calls=0;
  const harness=bridgeHarness(()=>{calls++;return promise;});
  assert.equal(harness.window.fetch(input,{method:"POST",get body(){throw new Error("must not read body");}}),promise);
  await waitFor(()=>harness.posts.some(message=>message.type==="users"));
  assert.equal(calls,1);assert.equal(harness.posts.find(m=>m.type==="users").users[0].followersCount,100);
  assert.deepEqual(await response.json(),payload);
 }
 const harness=bridgeHarness(()=>Promise.resolve());const xhr=new harness.XHR();
 xhr.open("POST",url);xhr.send();xhr.finish(payload,"json");
 assert.equal(harness.posts.find(m=>m.type==="users").users[0].followersCount,100);
 assert.equal(data.isApiUrl(url,"https://x.com/home","POST"),true);
 assert.equal(data.isApiUrl("/i/api/graphql/test/SidebarUserRecommendations","https://x.com/home","GET"),true);
 assert.equal(data.isApiUrl("/i/api/1.1/users/show.json","https://x.com/home","POST"),false);
});
