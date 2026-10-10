(() => {
  "use strict";

  const channel = "x-follower-count:v1";
  const maxUsers = 10000;
  const maxBatch = 500;

  function normalizeUser(value) {
    if (!value || typeof value !== "object") return null;
    const { screenName } = value;
    if (typeof screenName !== "string" || !/^[a-z0-9_]{1,15}$/i.test(screenName)) return null;
    const user = { screenName: screenName.toLowerCase() };
    if (typeof value.userId === "string" && /^\d{1,40}$/.test(value.userId)) user.userId = value.userId;
    for (const key of ["followersCount", "followingCount", "tweetCount", "mediaCount"])
      if (Number.isSafeInteger(value[key]) && value[key] >= 0) user[key] = value[key];
    for (const key of ["following", "followedBy"])
      if (typeof value[key] === "boolean") user[key] = value[key];
    if (Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 && value.createdAt <= 8640000000000000) user.createdAt = value.createdAt;
    for (const key of ["name", "category"])
      if (typeof value[key] === "string" && value[key].length <= 120) user[key] = value[key];
    if (["blue", "business", "government", "verified", "none"].includes(value.verification)) user.verification = value.verification;
    if (typeof value.website === "string" && value.website.length <= 2048) {
      try { const url = new URL(value.website); if (["https:", "http:"].includes(url.protocol)) user.website = url.href; } catch {}
    }
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
        userId: node.rest_id ?? node.id_str ?? (typeof node.id === "string" && /^\d+$/.test(node.id) ? node.id : undefined),
        name: node.core?.name ?? node.legacy?.name ?? node.name,
        screenName: node.core?.screen_name ?? node.legacy?.screen_name ?? node.screen_name,
        followersCount: node.relationship_counts?.followers ?? node.legacy?.followers_count ?? node.followers_count ?? node.public_metrics?.followers_count,
        followingCount: node.relationship_counts?.following ?? node.legacy?.friends_count ?? node.friends_count ?? node.public_metrics?.following_count,
        tweetCount: node.tweet_counts?.tweets ?? node.legacy?.statuses_count ?? node.statuses_count ?? node.public_metrics?.tweet_count,
        mediaCount: node.tweet_counts?.media_tweets ?? node.legacy?.media_count,
        verification: ["blue", "business", "government"].includes(node.verification?.verified_type ?? node.legacy?.verified_type ?? node.verified_type) ? (node.verification?.verified_type ?? node.legacy?.verified_type ?? node.verified_type) : node.is_blue_verified === true ? "blue" : (node.verification?.verified ?? node.legacy?.verified) === true ? "verified" : node.is_blue_verified === false && (node.verification?.verified ?? node.legacy?.verified) === false ? "none" : undefined,
        category: node.professional?.category?.[0]?.name,
        website: node.profile_bio?.entities?.url?.urls?.[0]?.expanded_url ?? node.legacy?.entities?.url?.urls?.[0]?.expanded_url ?? node.website?.url ?? node.legacy?.url,
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

  function formatAccountAge(createdAt, now = Date.now()) {
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !Number.isFinite(now) || createdAt > now) return null;
    if (isNewAccount(createdAt, now)) return "新号";
    const start = new Date(createdAt);
    const end = new Date(now);
    let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    // Count completed calendar months, clamping an anniversary to month end.
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    const anniversary = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds());
    if (anniversary > now) months--;
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    if (years) return `${years}年${remainder ? `${remainder}个月` : ""}`;
    return `${months}个月`;
  }

  function formatCount(count) {
    if (count >= 100000000) return `${Number((count / 100000000).toFixed(1))}亿`;
    if (count >= 10000) return `${Number((count / 10000).toFixed(1))}万`;
    return count.toLocaleString("en-US");
  }

  const userOperations = new Set([
    "HomeTimeline", "HomeLatestTimeline", "UserByScreenName", "UserByRestId",
    "UserTweets", "UserTweetsAndReplies", "UserMedia", "TweetDetail", "SearchTimeline",
    "Followers", "Following", "BlueVerifiedFollowers", "FollowersYouKnow",
    "ListLatestTweetsTimeline", "CommunityTweetsTimeline", "CommunityMediaTimeline",
    "SidebarUserRecommendations", "ConnectTabTimeline", "Bookmarks", "Likes"
  ]);
  function isApiUrl(value, base, method = "GET") {
    try {
      const url = new URL(value, base);
      const verb = String(method).toUpperCase();
      return url.protocol === "https:" &&
        /^(?:(?:www|api)\.)?(?:x\.com|twitter\.com)$/.test(url.hostname) &&
        (["GET", "POST"].includes(verb) && userOperations.has(url.pathname.match(/^\/i\/api\/graphql\/[^/]+\/([^/]+)$/)?.[1]) ||
          verb === "GET" && /^\/(?:i\/api\/)?1\.1\/(?:users\/(?:show|lookup)|followers\/list|friends\/list)\.json$/.test(url.pathname));
    } catch {
      return false;
    }
  }

  const api = Object.freeze({ channel, maxUsers, maxBatch, normalizeUser, extractUsers, formatCount, isNewAccount, formatAccountAge, isApiUrl });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "__xfcData", { value: api, configurable: true });
})();
