(() => {
  "use strict";
  const controller = new AbortController();
  const cleanups = new Set();
  let stopped = false;
  function dispose() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    for (const cleanup of cleanups) { try { cleanup(); } catch {} }
    cleanups.clear();
  }
  function active() {
    if (stopped) return false;
    try { if (globalThis.chrome?.runtime?.id) return true; } catch {}
    dispose();
    return false;
  }
  async function send(type, extra = {}) {
    if (!active()) return { ok: false };
    try {
      const result = await chrome.runtime.sendMessage({ channel: "xfc-local", type, ...extra });
      return result ?? { ok: false };
    } catch (error) {
      if (/context invalidated/i.test(String(error)) || !active()) dispose();
      return { ok: false };
    }
  }
  function post(message) {
    if (!active()) return;
    try { window.postMessage(message, location.origin); }
    catch { dispose(); }
  }
  Object.defineProperty(globalThis, "__xfcRuntime", { value: Object.freeze({
    active, send, post, signal: controller.signal,
    cleanup: fn => stopped ? fn() : cleanups.add(fn)
  }) });
})();
