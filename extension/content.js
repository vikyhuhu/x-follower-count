(() => {
  "use strict";
  // Execution worlds are independent. Keep this UI receiver self-contained;
  // Chrome can deduplicate a file declared in multiple content-script entries.
  const runtime = globalThis.__xfcRuntime;
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
  function countTier(count) {
    if (count >= 1000000) return "million";
    if (count >= 100000) return "hundred-thousand";
    if (count >= 10000) return "ten-thousand";
    if (count >= 1000) return "thousand";
    return "small";
  }
  const rootSelector = '[data-testid="User-Name"], [data-testid="UserName"], [data-testid="UserCell"]';
  const badgeSelector = ".xfc-badge";
  const users = new Map();
  const card = globalThis.__xfcCard;
  card.init({ getUser: handle => users.get(handle), formatAge: formatAccountAge });
  const dirty = new Set();
  const reserved = new Set(["home", "explore", "search", "notifications", "messages", "settings", "compose", "i", "intent", "share", "login", "logout", "signup", "tos", "privacy"]);
  let scheduled = false;
  let refreshAll = false;

  function profileHandle(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      if (!/^(?:www\.)?(?:x\.com|twitter\.com)$/.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/([a-z0-9_]{1,15})\/?$/i);
      if (!match || reserved.has(match[1].toLowerCase())) return null;
      return match[1].toLowerCase();
    } catch {
      return null;
    }
  }

  function nameLink(root) {
    // Some UserCell variants wrap a dedicated name header. Let that inner
    // header own the badge rather than adding a second one on the @handle.
    if (root.matches('[data-testid="UserCell"]') && root.querySelector('[data-testid="User-Name"], [data-testid="UserName"]')) return null;
    const links = [...root.querySelectorAll('a[href]')].filter(link =>
      link.closest(rootSelector) === root && profileHandle(link) && link.textContent.trim()
    );
    return links.find(link => !link.textContent.trim().startsWith("@")) ?? links[0];
  }

  function placeLabels(root, link, row) {
    const cell = root.closest('[data-testid="UserCell"]');
    row.classList.toggle("xfc-list-labels", !!cell);
    if (!cell) {
      root.classList.add("xfc-header-row");
      if (root.lastElementChild !== row) root.append(row);
      return;
    }
    if (root !== cell) {
      root.classList.add("xfc-list-header");
      if (root.lastElementChild !== row) root.append(row);
      return;
    }
    const handleLink = [...root.querySelectorAll('a[href]')].find(candidate =>
      candidate.closest(rootSelector) === root && candidate.textContent.trim().startsWith("@") && profileHandle(candidate) === profileHandle(link)
    );
    let host = link.parentElement;
    while (host !== root && handleLink && !host.contains(handleLink)) host = host.parentElement;
    if (host !== root && handleLink) {
      // List identities keep their stacked layout; labels get a separate row.
      host.classList.add("xfc-list-header");
      if (host.lastElementChild !== row) host.append(row);
    } else {
      const tail = handleLink ?? link.parentElement;
      if (tail.nextElementSibling !== row) tail.after(row);
    }
  }

  function render(root) {
    if (!root.isConnected) return;
    const link = nameLink(root);
    const handle = link && profileHandle(link);
    const user = handle ? users.get(handle) : undefined;
    const owned = selector => [...root.querySelectorAll(selector)].filter(node => node.closest(rootSelector) === root);
    let row = owned(".xfc-labels")[0];
    owned(".xfc-labels").slice(1).forEach(node => node.remove());
    const badges = owned(badgeSelector);
    let badge = badges.shift(); badges.forEach(node => node.remove());
    if (!link || !user) {
      badge?.remove(); row?.remove(); owned(".xfc-metadata").forEach(node => node.remove());
      return;
    }
    if (!row) { row = document.createElement("span"); row.className = "xfc-labels"; }
    if (user.followersCount === undefined) badge?.remove();
    else {
      if (!badge) { badge = document.createElement("span"); badge.className = "xfc-badge"; }
      const text = `粉丝 ${formatCount(user.followersCount)}`;
      if (badge.textContent !== text) badge.textContent = text;
      const tier = countTier(user.followersCount);
      if (badge.dataset.xfcTier !== tier) badge.dataset.xfcTier = tier;
      if (row.firstElementChild !== badge) row.prepend(badge);
      card.bind(badge, handle);
    }
    renderMetadata(root, user, row);
    if (!row.childElementCount) { row.remove(); return; }
    placeLabels(root, link, row);
  }

  function renderMetadata(root, user, container) {
    const rows = [...root.querySelectorAll(".xfc-metadata")].filter(node => node.closest(rootSelector) === root);
    let row = rows.shift();
    rows.forEach(node => node.remove());
    const labels = [];
    if (user?.following === true && user.followedBy === true) {
      labels.push({ kind: "mutual", text: "互相关注", title: "你关注了对方，对方也关注了你" });
    } else if (user?.followedBy === true) {
      labels.push({ kind: "follows-you", text: "关注了你", title: "对方关注了你" });
    } else if (user?.following === true) {
      labels.push({ kind: "following", text: "你已关注", title: "你关注了对方" });
    }
    const age = formatAccountAge(user?.createdAt);
    if (age) {
      const date = new Date(user.createdAt).toISOString().slice(0, 19).replace("T", " ");
      labels.push({ kind: age === "新号" ? "new" : age.includes("年") ? "age" : "recent", text: age, title: `注册于 ${date}（UTC）` });
    }
    if (!labels.length) {
      row?.remove();
      return;
    }
    if (!row) {
      row = document.createElement("div");
      row.className = "xfc-metadata";
    }
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      let badge = row.children[index];
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "xfc-meta-badge";
        row.append(badge);
      }
      if (badge.dataset.xfcKind !== label.kind) badge.dataset.xfcKind = label.kind;
      if (badge.textContent !== label.text) badge.textContent = label.text;
      const title = label.title;
      if (badge.title !== title) {
        badge.title = title;
        badge.setAttribute("aria-label", title);
      }
    }
    for (const badge of row.children) card.bind(badge, user.screenName);
    while (row.children.length > labels.length) row.lastElementChild.remove();
    if (container.lastElementChild !== row) container.append(row);
  }

  function updateTheme() {
    const background = getComputedStyle(document.body).backgroundColor;
    const parts = background.match(/[\d.]+/g)?.map(Number);
    const opaque = parts && (parts.length < 4 || parts[3] > 0);
    const dark = opaque ? (parts[0] * 0.299 + parts[1] * 0.587 + parts[2] * 0.114) < 128 :
      matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = dark ? "dark" : "light";
    if (document.documentElement.dataset.xfcTheme !== theme) document.documentElement.dataset.xfcTheme = theme;
  }

  function schedule(all = false) {
    if (!runtime.active()) return;
    refreshAll ||= all;
    if (scheduled || !document.body) return;
    scheduled = true;
    requestAnimationFrame(() => {
      if (!runtime.active()) return;
      scheduled = false;
      updateTheme();
      if (refreshAll) {
        document.querySelectorAll(rootSelector).forEach(root => dirty.add(root));
        refreshAll = false;
      }
      const roots = [...dirty];
      dirty.clear();
      roots.forEach(render);
    });
  }

  window.addEventListener("message", event => {
    if (!runtime.active()) return;
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === "reset") {
      users.clear();
      card.hide();
      schedule(true);
      return;
    }
    if (event.data.type === "bridge-ready") {
      runtime.post({ channel, type: "ready" });
      return;
    }
    if (event.data.type === "observations") {
      const batch = event.data;
      if (!Array.isArray(batch.users) || batch.users.length > maxBatch) return;
      const observed = batch.users.map(normalizeUser).filter(Boolean);
      runtime.send("observe", { users: observed }).then(result => { if (result?.ok) card.refresh(); }).catch(() => {});
      return;
    }
    if (event.data.type !== "users" || !Array.isArray(event.data.users) || event.data.users.length > maxBatch) return;
    let changed = false;
    for (const value of event.data.users) {
      const user = normalizeUser(value);
      if (!user) continue;
      const previous = users.get(user.screenName);
      const merged = { ...(previous?.userId && user.userId && previous.userId !== user.userId ? {} : previous), ...user };
      if (!previous || Object.keys(merged).some(key => previous[key] !== merged[key])) changed = true;
      users.delete(user.screenName);
      users.set(user.screenName, merged);
    }
    while (users.size > maxUsers) users.delete(users.keys().next().value);
    if (changed) schedule(true);
  }, { signal: runtime.signal });
  runtime.post({ channel, type: "ready" });

  function start() {
    if (!runtime.active()) return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        const owner = target?.closest(rootSelector);
        if (owner) dirty.add(owner);
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches(rootSelector)) dirty.add(node);
          node.querySelectorAll(rootSelector).forEach(root => dirty.add(root));
        }
      }
      if (dirty.size) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "data-testid"] });
    runtime.cleanup(() => observer.disconnect());
    const themeObserver = new MutationObserver(() => schedule());
    for (const node of [document.body, document.documentElement]) {
      themeObserver.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
    }
    runtime.cleanup(() => themeObserver.disconnect());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => schedule(), { signal: runtime.signal });
    // Recheck age labels while a page stays open; no network work.
    const ageTimer = setInterval(() => {
      if (!runtime.active()) return;
      if (document.querySelector('.xfc-meta-badge[data-xfc-kind="new"], .xfc-meta-badge[data-xfc-kind="age"]')) schedule(true);
    }, 60000);
    runtime.cleanup(() => clearInterval(ageTimer));
    schedule(true);
  }
  runtime.cleanup(() => {
    users.clear(); dirty.clear(); card.hide();
    document.querySelectorAll(".xfc-labels").forEach(node => node.remove());
    document.querySelectorAll(".xfc-header-row, .xfc-list-header").forEach(node => node.classList.remove("xfc-header-row", "xfc-list-header"));
  });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true, signal: runtime.signal });
})();
