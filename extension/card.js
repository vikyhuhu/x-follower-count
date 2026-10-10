(() => {
  "use strict";
  const runtime = globalThis.__xfcRuntime;
  const history = globalThis.__xfcHistory;
  let config, card, anchor, activeHandle, timer, hideTimer, request = 0, open = false;
  const triggerSelector = ".xfc-badge, .xfc-meta-badge";
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("en-US") : "—";
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute("translate", "no");
    node.classList.add("notranslate");
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const send = (...args) => runtime.send(...args);
  function relation(user) {
    if (user.following === true && user.followedBy === true) return "互相关注";
    if (user.followedBy === true) return "关注了你";
    if (user.following === true) return "你已关注";
    return user.following === false && user.followedBy === false ? "双方未关注" : "关系未知";
  }
  function pair(list, label, text) {
    list.append(element("dt", "", label));
    const value = element("dd", "", text); list.append(value);
    if (text === "—") { value.title = "暂未获取"; value.setAttribute("aria-label", `${label}暂未获取`); }
    return value;
  }
  function build() {
    card = element("section", "xfc-card notranslate"); card.setAttribute("translate", "no"); card.id = "xfc-account-card"; card.hidden = true;
    card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "账号详情");
    card.addEventListener("click", event => event.stopPropagation());
    card.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    card.addEventListener("pointerleave", () => laterHide());
    document.body.append(card);
  }
  function position() {
    if (!open || !anchor?.isConnected) { hide(); return; }
    const rect = anchor.getBoundingClientRect(), width = Math.min(320, innerWidth - 16);
    if (rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
    card.style.width = `${width}px`;
    for (const value of card.querySelectorAll(".xfc-bar-value")) {
      value.style.fontSize = "10px";
      if (value.scrollWidth > value.clientWidth) value.style.fontSize = `${10 * value.clientWidth / value.scrollWidth * .95}px`;
    }
    const below = Math.max(0, innerHeight - rect.bottom - 15), above = Math.max(0, rect.top - 15);
    const placeBelow = below >= Math.min(520, card.scrollHeight) || below >= above;
    const available = Math.max(60, placeBelow ? below : above);
    card.style.maxHeight = `${available}px`;
    const height = Math.min(card.scrollHeight, available);
    card.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    card.style.top = `${Math.max(8, placeBelow ? rect.bottom + 7 : rect.top - height - 7)}px`;
  }
  function hide() {
    clearTimeout(timer); clearTimeout(hideTimer); request++;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    if (card) card.hidden = true;
    open = false; activeHandle = null;
  }
  function laterHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!card?.matches(":hover") && !card?.contains(document.activeElement) && !anchor?.matches(":hover") && document.activeElement !== anchor) hide();
    }, 180);
  }
  function followerChart(parent, entries) {
    const section = element("section", "xfc-chart-section");
    section.append(element("h3", "", "近7天粉丝趋势"));
    // Start at the first observed day in the seven-day window. Missing days
    // inside that span stay blank rather than becoming zero or inferred values.
    const first = entries.findIndex(day => day.count !== null);
    const visible = first < 0 ? [] : entries.slice(first);
    const maximum = Math.max(1, ...visible.map(day => day.count ?? 0));
    const plot = element("div", "xfc-bars");
    plot.setAttribute("role", "img");
    plot.setAttribute("aria-label", visible.length ? `近7天粉丝趋势，北京时间；${visible.map(day => `${day.day}：${day.count === null ? "未获取" : number(day.count) + "位粉丝"}`).join("；")}` : "近7天粉丝趋势，暂无记录");
    for (const entry of visible) {
      const column = element("div", "xfc-bar-column");
      column.dataset.day = entry.day; column.setAttribute("aria-hidden", "true");
      const track = element("div", "xfc-bar-track");
      if (entry.count !== null) {
        column.dataset.count = String(entry.count);
        track.append(element("span", "xfc-bar-value", number(entry.count)));
        const bar = element("div", "xfc-bar");
        bar.style.height = `${entry.count / maximum * 84}px`;
        track.append(bar);
      }
      column.append(track, element("span", "xfc-bar-date", entry.day.slice(5).replace("-", "/")));
      plot.append(column);
    }
    section.append(plot); parent.append(section);
  }
  function render(user, result) {
    const focused = card.contains(document.activeElement) ? document.activeElement.dataset.xfcAction : null;
    card.replaceChildren();
    const header = element("header", "xfc-card-header");
    const identity = element("div", "xfc-identity");
    const title = element("div", "xfc-title-row");
    const status = element("span", "xfc-status-badge xfc-relation", relation(user));
    status.dataset.xfcKind = user.following === true && user.followedBy === true ? "mutual" : user.followedBy === true ? "follows-you" : user.following === true ? "following" : "none";
    title.append(element("h2", "", user.name || `@${user.screenName}`), status);
    identity.append(title, element("p", "xfc-handle", `@${user.screenName}`));
    const close = element("button", "xfc-close", "×"); close.type = "button"; close.dataset.xfcAction = "close"; close.setAttribute("aria-label", "关闭账号详情");
    close.addEventListener("click", () => { const previous = anchor; hide(); previous?.focus(); hide(); });
    header.append(identity, close); card.append(header);
    const list = element("dl", "xfc-facts");
    pair(list, "关注数", number(user.followingCount)); pair(list, "粉丝数", number(user.followersCount));
    const ratio = user.followersCount === undefined || user.followingCount === undefined ? "—" : user.followingCount === 0 ? "未关注任何账号" : `${Math.round(user.followersCount / user.followingCount).toLocaleString("en-US")} : 1`;
    pair(list, "粉关比", ratio); pair(list, "总发帖数", number(user.tweetCount));
    const age = config.formatAge(user.createdAt);
    pair(list, "账号年龄", age === "新号" ? `${Math.floor((Date.now() - user.createdAt) / history.DAY)}天` : age || "—");
    pair(list, "注册时间", age ? `${new Date(user.createdAt).toISOString().slice(0, 19).replace("T", " ")} UTC` : "—").className = "xfc-date";
    const options = result.settings ?? history.defaults;
    if (options.verification && user.verification) pair(list, "认证状态", { blue: "蓝标", business: "企业认证", government: "政府／组织认证", verified: "已认证", none: "未认证" }[user.verification]);
    if (options.media && user.mediaCount !== undefined) pair(list, "媒体帖数", number(user.mediaCount));
    if (options.category && user.category) pair(list, "账号自填类别", user.category);
    if (options.website && user.website) {
      const value = pair(list, "个人网站", "");
      const link = element("a", "", user.website); link.href = user.website; link.target = "_blank"; link.rel = "noopener noreferrer"; value.append(link);
    }
    card.append(list);
    followerChart(card, history.series(result.record).followers);
    if (!result.ok) card.append(element("p", "xfc-error", "本地记录暂不可用，请重新加载扩展后刷新页面。"));
    if (focused) card.querySelector(`[data-xfc-action="${focused}"]`)?.focus();
    position();
  }
  async function show(trigger) {
    if (!runtime.active()) return;
    clearTimeout(timer); clearTimeout(hideTimer);
    const handle = trigger.dataset.xfcHandle;
    const current = config.getUser(handle);
    if (!current) return;
    const sameAccount = open && activeHandle === handle;
    if (!card) build();
    if (anchor && anchor !== trigger) anchor.setAttribute("aria-expanded", "false");
    anchor = trigger; activeHandle = handle; open = true; card.hidden = false;
    anchor.setAttribute("aria-expanded", "true");
    const sequence = ++request;
    if (sameAccount) position();
    else render(current, { ok: true, pending: true, settings: history.defaults });
    const result = await send("get", { userId: current.userId });
    if (!runtime.active() || !open || sequence !== request || !trigger.isConnected || trigger.dataset.xfcHandle !== handle) return;
    render(config.getUser(handle), result);
  }
  function bind(trigger, handle) {
    trigger.dataset.xfcHandle = handle;
    trigger.removeAttribute("title"); trigger.tabIndex = 0; trigger.setAttribute("role", "button");
    const aria = `${trigger.textContent}，查看 @${handle} 账号详情`;
    if (trigger.getAttribute("aria-label") !== aria) trigger.setAttribute("aria-label", aria);
    trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-controls", "xfc-account-card");
    trigger.setAttribute("aria-expanded", open && anchor === trigger ? "true" : "false");
    if (anchor === trigger && open && activeHandle !== handle) hide();
  }
  function init(options) {
    config = options;
    runtime.cleanup(() => { hide(); card?.remove(); });
    document.addEventListener("pointerover", event => {
      const trigger = event.target.closest?.(triggerSelector);
      if (!trigger) return;
      clearTimeout(hideTimer); clearTimeout(timer);
      if (open && activeHandle === trigger.dataset.xfcHandle) { anchor?.setAttribute("aria-expanded", "false"); anchor = trigger; anchor.setAttribute("aria-expanded", "true"); return; }
      timer = setTimeout(() => show(trigger), 250);
    }, { signal: runtime.signal });
    document.addEventListener("pointerout", event => {
      if (event.target.closest?.(triggerSelector)) { clearTimeout(timer); laterHide(); }
    }, { signal: runtime.signal });
    document.addEventListener("focusin", event => { if (event.target.matches?.(triggerSelector)) show(event.target); }, { signal: runtime.signal });
    document.addEventListener("focusout", event => { if (event.target.closest?.(triggerSelector) || card?.contains(event.target)) laterHide(); }, { signal: runtime.signal });
    document.addEventListener("click", event => {
      const trigger = event.target.closest?.(triggerSelector);
      if (trigger) { event.preventDefault(); event.stopPropagation(); show(trigger); }
      else if (card?.contains(event.target)) return;
      else if (open) hide();
    }, { capture: true, signal: runtime.signal });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && open) { event.preventDefault(); const previous = anchor; hide(); previous?.focus(); hide(); }
      else if (["Enter", " "].includes(event.key) && event.target.matches?.(triggerSelector)) { event.preventDefault(); event.stopPropagation(); show(event.target); }
    }, { capture: true, signal: runtime.signal });
    window.addEventListener("resize", position, { signal: runtime.signal });
    document.addEventListener("scroll", event => { if (open && !card?.contains(event.target)) hide(); }, { capture: true, signal: runtime.signal });
  }
  const api = Object.freeze({ init, bind, hide, refresh: () => { if (open && anchor?.isConnected && !card?.contains(document.activeElement)) show(anchor); } });
  Object.defineProperty(globalThis, "__xfcCard", { value: api });
})();
