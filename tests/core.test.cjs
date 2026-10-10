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
  const users = Object.fromEntries(data.extractUsers(payload).map(user => [user.screenName, user.followersCount]));
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
  const users = Object.fromEntries(data.extractUsers(payload).map(user => [user.screenName, user.followersCount]));
  assert.deepEqual(users, { currentzero: 0, currentuser: 48495 });
});

test("Chinese compact display and zero are accurate", () => {
  for (const [count, text] of [[0, "0"], [423, "423"], [1574, "1,574"], [9999, "9,999"], [10000, "1万"], [11000, "1.1万"], [174000, "17.4万"], [100000000, "1亿"]]) {
    assert.equal(data.formatCount(count), text);
  }
});

test("only X API responses are inspected", () => {
  for (const url of ["/i/api/graphql/abc/HomeTimeline", "https://api.x.com/1.1/users/show.json", "https://twitter.com/i/api/2/test"]) assert.equal(data.isApiUrl(url, "https://x.com/home"), true);
  for (const url of ["https://evilx.com/i/api/test", "https://x.com.evil.test/i/api/test", "/settings", "http://x.com/i/api/test", "https://example.com/i/api/graphql/abc"]) assert.equal(data.isApiUrl(url, "https://x.com/home"), false);
});

function bridgeHarness(fetch) {
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
  const context = vm.createContext({ window, location: { origin: "https://x.com", href: "https://x.com/home" }, XMLHttpRequest: XHR, URL, __xfcData: data });
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
  assert.equal(harness.posts.length, before + 1);
  assert.equal(harness.posts.at(-1).users[0].screenName, "alice");
});

test("manifest restricts injection to X and contains only existing local files", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json")));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.background, undefined);
  for (const script of manifest.content_scripts) {
    assert.equal(script.run_at, "document_start");
    for (const name of [...script.js, ...(script.css ?? [])]) assert.equal(fs.existsSync(path.join(extension, name)), true);
    assert.deepEqual(script.matches, ["https://x.com/*", "https://www.x.com/*", "https://twitter.com/*", "https://www.twitter.com/*"]);
  }
});
