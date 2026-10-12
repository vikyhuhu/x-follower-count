"use strict";
importScripts("data.js", "history.js");
const storageKey = "xfc-history-v1";
const model = globalThis.__xfcHistory;
// Chrome 111–113 have a smaller local quota. Keep headroom for settings and
// storage accounting without asking for broader permissions.
const historyBudget = Math.min(model.MAX_BYTES, (chrome.storage.local.QUOTA_BYTES ?? model.MAX_BYTES + 512 * 1024) - 512 * 1024);
let state, queue = Promise.resolve();
async function load() {
  if (!state) {
    const result = (await chrome.storage.local.get(storageKey))[storageKey];
    state = result?.version === 1 && result.users && typeof result.users === "object" && !Array.isArray(result.users) ? result : model.empty();
  }
  const before = JSON.stringify(state);
  model.prune(state, Date.now(), historyBudget);
  // Persist migration and expiry even when recording is disabled.
  if (before !== JSON.stringify(state)) await chrome.storage.local.set({ [storageKey]: state });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.channel !== "xfc-local" || sender.id !== chrome.runtime.id) return;
  if (sender.tab && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(sender.url ?? "") && !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return;
  const ownPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  const task = queue.then(async () => {
    await load();
    let changed = false;
    switch (message.type) {
      case "observe": {
        if (!state.settings.recording) return { ok: true };
        if (!Array.isArray(message.users) || message.users.length > 500) throw new Error("Invalid batch");
        const users = message.users.map(globalThis.__xfcData.normalizeUser).filter(Boolean);
        model.observe(state, users, Date.now(), historyBudget);
        changed = true; break;
      }
      case "get":
        return { ok: true, record: state.settings.recording && model.validId(message.userId) ? state.users[message.userId] ?? null : null, settings: state.settings };
      case "clear-all":
        if (!ownPage) return { ok: false };
        state.users = {}; changed = true; break;
      case "settings":
        if (!ownPage) return { ok: false };
        state.settings = model.settings(message.settings); changed = true; break;
      case "status": return { ok: true, users: Object.keys(state.users).length, settings: state.settings, bytes: await chrome.storage.local.getBytesInUse(storageKey) };
      default: return { ok: false, error: "Unknown action" };
    }
    if (changed) await chrome.storage.local.set({ [storageKey]: state });
    return { ok: true };
  });
  queue = task.catch(() => {});
  task.then(respond, () => { state = undefined; respond({ ok: false, error: "本地记录暂不可用，请重试" }); });
  return true;
});
