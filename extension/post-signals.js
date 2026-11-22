(() => {
  "use strict";

  const tweetSelector = 'article[data-testid="tweet"]';
  const groupSelector = '[role="group"]';
  const rowClass = "xfc-post-signals";
  const actions = {
    bookmark: "bookmarks", removeBookmark: "bookmarks",
    like: "likes", unlike: "likes", retweet: "reposts", unretweet: "reposts", reply: "replies"
  };
  const buttons = Object.keys(actions).map(id => 'button[data-testid="' + id + '"]').join(",");
  const number = String.raw`(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:[.,]\d+)?(?:\s*[kmb万萬亿億])?`;
  const words = {
    bookmarks: "bookmarks?|(?:(?:次|个|個)\\s*)?(?:收藏|书签|書籤)",
    likes: "likes?|(?:(?:个|個|次)\\s*)?(?:点赞|點讚|喜欢|喜歡|讚|赞)",
    reposts: "reposts?|retweets?|(?:次\\s*)?(?:转发|轉發|轉推)",
    replies: "repl(?:y|ies)|(?:(?:条|條|次|则|則)\\s*)?(?:回复|回覆|评论|評論)"
  };
  const groupPatterns = Object.fromEntries(Object.entries(words).map(([key, word]) => [
    key, new RegExp("(?:^|[\\s,，、;；])(" + number + ")\\s*(?:" + word + ")(?=$|[\\s,，.。、;；])", "i")
  ]));
  const firstNumber = new RegExp("^(" + number + ")(?=$|[^\\d.,])", "i");
  const scales = { k: 1000, m: 1000000, b: 1000000000, 万: 10000, 萬: 10000, 亿: 100000000, 億: 100000000 };
  const rows = new WeakMap();

  function normalize(text) {
    return (text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function parseCount(text) {
    const source = normalize(text).toLowerCase();
    const suffix = source.at(-1);
    const scale = scales[suffix];
    const digits = (scale ? source.slice(0, -1).trim() : source).replace(/(?<=\d)[ ,](?=\d{3}(?:\D|$))/g, "");
    if (!(scale ? /^\d+(?:[.,]\d+)?$/ : /^\d+$/).test(digits)) return null;
    const value = Math.round(Number(digits.replace(",", ".")) * (scale ?? 1));
    return Number.isSafeInteger(value) ? { value, estimated: Boolean(scale) } : null;
  }

  function groupCounts(text) {
    const label = normalize(text);
    const counts = {};
    for (const [key, pattern] of Object.entries(groupPatterns)) {
      const match = label.match(pattern);
      if (match) counts[key] = parseCount(match[1]);
    }
    return counts;
  }

  function describe(counts) {
    const result = [];
    const { bookmarks, likes, reposts, replies } = counts;
    if (bookmarks && likes?.value > 0) {
      const percent = bookmarks.value / likes.value * 100;
      const high = percent >= 30;
      const rounded = Number(percent.toFixed(1));
      const label = !high && rounded === 30 ? "<30%" : rounded + "%";
      const approx = bookmarks.estimated || likes.estimated ? "约 " : "";
      result.push({
        tone: high ? "save" : "plain",
        text: "收藏/赞 " + approx + label,
        title: "收藏 " + bookmarks.value.toLocaleString("zh-CN") + "，点赞 " + likes.value.toLocaleString("zh-CN") +
          "。收藏/赞达到 30% 时标绿，可优先细读内容。"
      });
    }
    if (reposts && replies && (reposts.value > 0 || replies.value > 0)) {
      const tone = reposts.value >= replies.value ? "share" :
        replies.value >= 3 * Math.max(1, reposts.value) ? "discussion" : "plain";
      const approx = reposts.estimated || replies.estimated ? "约 " : "";
      result.push({
        tone,
        text: approx + "转 " + reposts.value.toLocaleString("zh-CN") + " / 评 " + replies.value.toLocaleString("zh-CN"),
        title: tone === "share" ? "转发不少于评论，可以看看这个观点为何被转发。" :
          tone === "discussion" ? "评论明显多于转发，可以去评论区找观点和例子。" :
            "转发数与评论数。"
      });
    }
    return result;
  }

  function actionGroup(article) {
    for (const group of article.querySelectorAll(groupSelector)) {
      if (group.closest(tweetSelector) !== article) continue;
      const controls = [...group.querySelectorAll(buttons)].filter(button =>
        button.closest(groupSelector) === group && button.closest(tweetSelector) === article
      );
      if (controls.length >= 2) return { group, controls };
    }
    return null;
  }

  function render(article) {
    if (!article.isConnected) return;
    const action = actionGroup(article);
    let labels = [];
    if (action) {
      const counts = groupCounts(action.group.getAttribute("aria-label"));
      for (const button of action.controls) {
        const metric = actions[button.dataset.testid];
        if (counts[metric] && !counts[metric].estimated) continue;
        const leadingCount = normalize(button.getAttribute("aria-label")).match(firstNumber)?.[1];
        const accessible = parseCount(leadingCount);
        const visible = parseCount(button.textContent);
        counts[metric] = accessible && !accessible.estimated ? accessible :
          visible && !visible.estimated ? visible : counts[metric] ?? accessible ?? visible;
      }
      labels = describe(counts);
    }
    const previous = rows.get(article);
    if (!labels.length) {
      previous?.node.remove();
      rows.delete(article);
      return;
    }
    const row = previous?.node ?? document.createElement("div");
    const signature = JSON.stringify(labels);
    if (signature !== previous?.signature) {
      row.className = rowClass;
      row.replaceChildren(...labels.map(label => {
        const item = document.createElement("span");
        item.className = "xfc-post-signal";
        item.dataset.xfcTone = label.tone;
        item.textContent = label.text;
        item.title = label.title;
        return item;
      }));
      rows.set(article, { node: row, signature });
    }
    if (action.group.nextElementSibling !== row) action.group.after(row);
  }

  const api = { tweetSelector, groupSelector, rowClass, render, describe, parseCount, groupCounts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "__xfcPostSignals", { value: api });
})();
