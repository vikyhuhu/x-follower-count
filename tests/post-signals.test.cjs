const { test } = require("node:test");
const assert = require("node:assert/strict");
const { describe, groupCounts, parseCount } = require("../extension/post-signals.js");

const signals = text => describe(groupCounts(text)).map(({ tone, text }) => [tone, text]);

test("marks the 30% bookmark threshold and keeps ratios above 100%", () => {
  assert.deepEqual(signals("100 likes,30 bookmarks"), [["save", "收藏/赞 30%"]]);
  assert.deepEqual(signals("100 likes, 200 bookmarks"), [["save", "收藏/赞 200%"]]);
  assert.deepEqual(signals("10,000 likes, 2,999 bookmarks"), [["plain", "收藏/赞 <30%"]]);
});

test("compares reposts to replies, with a separate color for concentrated discussion", () => {
  assert.deepEqual(signals("10 次转发，10 条回复"), [["share", "转 10 / 评 10"]]);
  assert.deepEqual(signals("44 reposts, 399 replies"), [["discussion", "转 44 / 评 399"]]);
  assert.deepEqual(signals("4 reposts, 11 replies"), [["plain", "转 4 / 评 11"]]);
  assert.deepEqual(signals("4 reposts, 12 replies"), [["discussion", "转 4 / 评 12"]]);
  assert.deepEqual(signals("0 reposts, 3 replies"), [["discussion", "转 0 / 评 3"]]);
  assert.deepEqual(signals("7 reposts,0 replies"), [["share", "转 7 / 评 0"]]);
});

test("uses numeric evidence, handles grouped and abbreviated counts, and leaves missing data blank", () => {
  assert.deepEqual(signals("10 条回复，10 次转发，1,183 个喜欢，257 次收藏"), [
    ["plain", "收藏/赞 21.7%"], ["share", "转 10 / 评 10"]
  ]);
  assert.deepEqual(signals("１２，０００ 個讚、4K 次收藏"), [["save", "收藏/赞 约 33.3%"]]);
  assert.deepEqual(parseCount("1.2 万"), { value: 12000, estimated: true });
  assert.equal(parseCount("未收藏"), null);
  assert.deepEqual(signals("0 likes, 2 bookmarks, 0 replies, 0 reposts"), []);
  assert.deepEqual(signals("6 bookmarks, 6 reposts"), []);
});
