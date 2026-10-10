(() => {
  "use strict";
  const DAY = 86400000, KEEP_DAYS = 30, MAX_USERS = 1000, MAX_BYTES = 8 * 1024 * 1024;
  const defaults = Object.freeze({ recording: false, verification: true, media: false, category: false, website: false });
  const validId = value => typeof value === "string" && /^\d{1,40}$/.test(value);
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  function dayKey(time) { return new Date(time + 8 * 3600000).toISOString().slice(0, 10); }
  function empty() { return { version: 1, users: {}, settings: { ...defaults } }; }
  function settings(value) { return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof value?.[key] === "boolean" ? value[key] : fallback])); }
  function prune(state, now = Date.now()) {
    const cutoff = now - KEEP_DAYS * DAY;
    const users = {};
    for (const [id, user] of Object.entries(state.users)) {
      if (!validId(id) || !user || !Number.isSafeInteger(user.lastSeen) || user.lastSeen < cutoff || user.lastSeen > now) continue;
      const days = {};
      for (const [day, record] of Object.entries(user.days ?? {})) {
        const { first, last } = record ?? {};
        if (!first || !last || !validCount(first.count) || !validCount(last.count) ||
          !Number.isSafeInteger(first.at) || !Number.isSafeInteger(last.at) || first.at < cutoff || last.at > now || first.at > last.at ||
          dayKey(first.at) !== day || dayKey(last.at) !== day) continue;
        days[day] = { first: { at: first.at, count: first.count }, last: { at: last.at, count: last.count } };
      }
      if (Object.keys(days).length) users[id] = { userId: id, lastSeen: user.lastSeen, days };
    }
    state.users = users;
    state.settings = settings(state.settings);
    const ordered = Object.entries(users).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    while (ordered.length > MAX_USERS) delete users[ordered.shift()[0]];
    while (ordered.length && new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_BYTES) delete users[ordered.shift()[0]];
    return state;
  }
  function observe(state, users, now = Date.now()) {
    prune(state, now);
    for (const user of users) {
      if (!validId(user.userId) || !validCount(user.followersCount)) continue;
      const record = state.users[user.userId] ??= { userId: user.userId, lastSeen: now, days: {} };
      record.lastSeen = now;
      const key = dayKey(now), snapshot = { at: now, count: user.followersCount };
      const daily = record.days[key] ??= { first: snapshot, last: snapshot };
      if (now < daily.first.at) daily.first = snapshot;
      if (now >= daily.last.at) daily.last = snapshot;
    }
    return prune(state, now);
  }
  function series(record, now = Date.now()) {
    const followers = Array.from({ length: 7 }, (_, i) => {
      const day = dayKey(now - (6 - i) * DAY), last = record?.days?.[day]?.last;
      return { day, count: last?.count ?? null };
    });
    return { followers };
  }
  const api = Object.freeze({ DAY, KEEP_DAYS, MAX_USERS, MAX_BYTES, defaults, validId, validCount, dayKey, empty, settings, prune, observe, series });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "__xfcHistory", { value: api });
})();
