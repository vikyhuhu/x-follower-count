(() => {
  "use strict";

  const channel = "x-follower-count:v1";
  const maxUsers = 10000;
  const maxBatch = 500;

  function normalizeUser(value) {
    if (!value || typeof value !== "object") return null;
    const { screenName, followersCount } = value;
    if (typeof screenName !== "string" || !/^[a-z0-9_]{1,15}$/i.test(screenName)) return null;
    if (!Number.isSafeInteger(followersCount) || followersCount < 0) return null;
    return { screenName: screenName.toLowerCase(), followersCount };
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
      // Keep the identity and count within the same user object.
      const user = normalizeUser({
        screenName: node.core?.screen_name ?? node.legacy?.screen_name ?? node.screen_name,
        followersCount: node.relationship_counts?.followers ?? node.legacy?.followers_count ?? node.followers_count ?? node.public_metrics?.followers_count
      });
      if (user) users.set(user.screenName, user);
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return [...users.values()];
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

  const api = Object.freeze({ channel, maxUsers, maxBatch, normalizeUser, extractUsers, formatCount, isApiUrl });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "__xfcData", { value: api, configurable: true });
})();
