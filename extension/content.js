(() => {
  "use strict";
  // Execution worlds are independent. Keep this UI receiver self-contained;
  // Chrome can deduplicate a file declared in multiple content-script entries.
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
  const counts = new Map();
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

  function render(root) {
    if (!root.isConnected) return;
    const link = nameLink(root);
    const handle = link && profileHandle(link);
    const count = handle ? counts.get(handle) : undefined;
    const badges = [...root.querySelectorAll(badgeSelector)].filter(badge => badge.closest(rootSelector) === root);
    let badge = badges.shift();
    for (const duplicate of badges) duplicate.remove();
    if (count === undefined || !link) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "xfc-badge";
    }
    const text = `粉丝 ${formatCount(count)}`;
    const title = `@${handle} · ${count.toLocaleString("en-US")} 位粉丝（来自页面已加载的数据）`;
    if (badge.textContent !== text) badge.textContent = text;
    if (badge.title !== title) {
      badge.title = title;
      badge.setAttribute("aria-label", title);
    }
    if (badge.dataset.xfcHandle !== handle) badge.dataset.xfcHandle = handle;
    // Use the unrounded count, including when an existing card is reused.
    const tier = countTier(count);
    if (badge.dataset.xfcTier !== tier) badge.dataset.xfcTier = tier;
    link.parentElement.classList.add("xfc-name-row");
    link.classList.add("xfc-name-link");
    if (link.nextElementSibling !== badge) link.after(badge);
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
    refreshAll ||= all;
    if (scheduled || !document.body) return;
    scheduled = true;
    requestAnimationFrame(() => {
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
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === "bridge-ready") {
      window.postMessage({ channel, type: "ready" }, location.origin);
      return;
    }
    if (event.data.type !== "users" || !Array.isArray(event.data.users) || event.data.users.length > maxBatch) return;
    let changed = false;
    for (const value of event.data.users) {
      const user = normalizeUser(value);
      if (!user) continue;
      if (counts.get(user.screenName) !== user.followersCount) changed = true;
      counts.delete(user.screenName);
      counts.set(user.screenName, user.followersCount);
    }
    while (counts.size > maxUsers) counts.delete(counts.keys().next().value);
    if (changed) schedule(true);
  });
  window.postMessage({ channel, type: "ready" }, location.origin);

  function start() {
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
    const themeObserver = new MutationObserver(() => schedule());
    for (const node of [document.body, document.documentElement]) {
      themeObserver.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
    }
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => schedule());
    schedule(true);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
