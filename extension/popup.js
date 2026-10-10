"use strict";
const status = document.querySelector("#status"), clear = document.querySelector("#clear"), confirm = document.querySelector("#confirm");
async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ channel: "xfc-local", type, ...extra });
  if (!result?.ok) throw new Error("本地记录暂不可用，请重试");
  return result;
}
async function refresh() {
  const result = await send("status");
  document.querySelector("#summary").textContent = `已记录 ${result.users} 个账号 · ${(result.bytes / 1024).toFixed(1)} KB`;
  for (const input of document.querySelectorAll("input")) input.checked = result.settings[input.name];
  document.querySelector("fieldset").disabled = false;
}
for (const input of document.querySelectorAll("input")) input.addEventListener("change", async () => {
  try { await send("settings", { settings: Object.fromEntries([...document.querySelectorAll("input")].map(input => [input.name, input.checked])) }); status.textContent = "已保存"; }
  catch (error) { status.textContent = error.message; }
});
clear.addEventListener("click", () => { confirm.hidden = false; clear.hidden = true; document.querySelector("#confirm-clear").focus(); });
document.querySelector("#cancel").addEventListener("click", () => { confirm.hidden = true; clear.hidden = false; clear.focus(); });
document.querySelector("#confirm-clear").addEventListener("click", async event => {
  event.target.disabled = true;
  try { await send("clear-all"); await refresh(); status.textContent = "全部趋势记录已清除；开启记录时，后续页面加载将开始新的记录。"; confirm.hidden = true; clear.hidden = false; clear.focus(); }
  catch (error) { status.textContent = error.message; }
  finally { event.target.disabled = false; }
});
refresh().catch(error => { status.textContent = error.message; });
