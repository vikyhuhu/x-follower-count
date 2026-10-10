(() => {
  "use strict";

  const channel = "x-follower-count:v1";
  const maxUsers = 10000;
  const maxBatch = 500;

  function normalizeUser(value) {
    if (!value || typeof value !== "object") return null;
    const { screenName, followersCount, following, followedBy, createdAt } = value;
    if (typeof screenName !== "string" || !/^[a-z0-9_]{1,15}$/i.test(screenName)) return null;
    const user = { screenName: screenName.toLowerCase() };
    if (Number.isSafeInteger(followersCount) && followersCount >= 0) user.followersCount = followersCount;
    if (typeof following === "boolean") user.following = following;
    if (typeof followedBy === "boolean") user.followedBy = followedBy;
    if (Number.isSafeInteger(createdAt) && createdAt >= 0 && createdAt <= 8640000000000000) user.createdAt = createdAt;
    return Object.keys(user).length > 1 ? user : null;
  }

  function firstBoolean(...values) {
    return values.find(value => typeof value === "boolean");
  }

  function creationTime(...values) {
    for (const value of values) {
      if (typeof value !== "string") continue;
      // Accept X's UTC date and ISO timestamps, not strings such as "1".
      if (!/^(?:[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} [+-]\d{4} \d{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))$/.test(value)) continue;
      const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
      const parts = value.split(" ");
      const year = iso ? Number(iso[1]) : Number(parts[5]);
      const month = iso ? Number(iso[2]) : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(parts[1]) + 1;
      const day = iso ? Number(iso[3]) : Number(parts[2]);
      const hour = iso ? Number(iso[4]) : Number(parts[3].split(":")[0]);
      const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23) continue;
      const time = Date.parse(value);
      if (Number.isFinite(time)) return time;
    }
  }

  function extractUsers(payload) {
    const users = new Map();
    const stack = [payload];
    const visited = new WeakSet();
    let remaining = 100000;
    while (stack.length && remaining-- > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || visited.has(node)) continue;
      visited.add(node);
      // X has returned both legacy.screen_name and core.screen_name layouts.
      // Keep identity and metadata within the same user object.
      const user = normalizeUser({
        screenName: node.core?.screen_name ?? node.legacy?.screen_name ?? node.screen_name,
        followersCount: node.relationship_counts?.followers ?? node.legacy?.followers_count ?? node.followers_count ?? node.public_metrics?.followers_count,
        following: firstBoolean(node.relationship_perspectives?.following, node.legacy?.following, node.following),
        followedBy: firstBoolean(node.relationship_perspectives?.followed_by, node.legacy?.followed_by, node.followed_by),
        createdAt: creationTime(node.core?.created_at, node.legacy?.created_at, node.created_at)
      });
      if (user) users.set(user.screenName, { ...users.get(user.screenName), ...user });
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return [...users.values()];
  }

  function isNewAccount(createdAt, now = Date.now()) {
    const age = now - createdAt;
    return Number.isSafeInteger(createdAt) && createdAt >= 0 && age >= 0 && age < 90 * 24 * 60 * 60 * 1000;
  }

  function formatCount(count) {
    if (count >= 100000000) return `${Number((count / 100000000).toFixed(1))}亿`;
    if (count >= 10000) return `${Number((count / 10000).toFixed(1))}万`;
    return count.toLocaleString("en-US");
  }

  function isApiUrl(value, base) {
    try {
      const url = new URL(value, base);
      return url.protocol === "https:" &&
        /^(?:(?:www|api)\.)?(?:x\.com|twitter\.com)$/.test(url.hostname) &&
        /^\/(?:i\/api|1\.1|2)\//.test(url.pathname);
    } catch {
      return false;
    }
  }

  const api = Object.freeze({ channel, maxUsers, maxBatch, normalizeUser, extractUsers, formatCount, isNewAccount, isApiUrl });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "__xfcData", { value: api, configurable: true });
})();
