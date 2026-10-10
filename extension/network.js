(() => {
  "use strict";
  const { channel, maxUsers, maxBatch, extractUsers, isApiUrl } = globalThis.__xfcData;
  const cache = new Map();

  function send(users) {
    for (let index = 0; index < users.length; index += maxBatch) {
      window.postMessage({ channel, type: "users", users: users.slice(index, index + maxBatch) }, location.origin);
    }
  }

  function consume(payload) {
    const changed = [];
    for (const user of extractUsers(payload)) {
      const previous = cache.get(user.screenName);
      cache.delete(user.screenName);
      cache.set(user.screenName, user);
      if (!previous || previous.followersCount !== user.followersCount) changed.push(user);
    }
    while (cache.size > maxUsers) cache.delete(cache.keys().next().value);
    send(changed);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel === channel && event.data.type === "ready") send([...cache.values()]);
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      // Return the original promise, preserving the site's response and timing.
      const pending = Reflect.apply(originalFetch, this, args);
      try {
        const url = typeof args[0] === "string" || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
        if (isApiUrl(url, location.href)) {
          pending.then(response => {
            if (response.ok) return response.clone().json().then(consume);
          }).catch(() => {});
        }
      } catch {
        // Reading an optional count must never break the site's own request.
      }
      return pending;
    };
  }

  const xhrUrls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    const result = Reflect.apply(originalOpen, this, args);
    xhrUrls.set(this, args[1]);
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (isApiUrl(xhrUrls.get(this), location.href)) {
      this.addEventListener("loadend", () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === "json") consume(this.response);
          else if (this.responseType === "" || this.responseType === "text") consume(JSON.parse(this.responseText));
        } catch {
          // Ignore non-JSON responses and failures without logging response data.
        }
      }, { once: true });
    }
    return Reflect.apply(originalSend, this, args);
  };

  // Replay works regardless of which execution world starts first.
  window.postMessage({ channel, type: "bridge-ready" }, location.origin);
})();
