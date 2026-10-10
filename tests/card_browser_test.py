"""Isolated real-MV3 tests for account cards, persistence and follower bars."""
import json
import os
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = Path(os.environ.get("EXTENSION_UNDER_TEST", str(ROOT / "extension")))
RESULTS = ROOT / "test-results"
RESULTS.mkdir(exist_ok=True)
now = datetime.now(timezone.utc)
ms = lambda date: int(date.timestamp() * 1000)
day = lambda date: (date + timedelta(hours=8)).strftime("%Y-%m-%d")
user = {"__typename": "User", "rest_id": "1", "core": {"screen_name": "Lauren", "name": "Lauren", "created_at": (now - timedelta(days=89)).isoformat()}, "relationship_counts": {"followers": 174000, "following": 320}, "relationship_perspectives": {"following": True, "followed_by": True}, "tweet_counts": {"tweets": 1578, "media_tweets": 45}, "is_blue_verified": True, "professional": {"category": [{"name": "Developer"}]}, "website": {"url": "https://example.com/"}}
other = {"rest_id": "2", "core": {"screen_name": "Tim", "name": "Tim"}, "relationship_counts": {"followers": 0, "following": 0}, "relationship_perspectives": {"following": False, "followed_by": False}}

def tweet(id, offset, extra=None):
    return {"__typename": "Tweet", "rest_id": str(id), "legacy": {"user_id_str": "1", "created_at": (now - timedelta(days=offset)).isoformat(), "full_text": "Do not persist this text", **(extra or {})}}
posts = [tweet(101, 0), tweet(102, 1, {"in_reply_to_status_id_str": "99"}), tweet(103, 1, {"is_quote_status": True}), tweet(101, 0), tweet(104, 0, {"retweeted_status_result": {"result": tweet(101, 0)}})]
payload = {"data": {"users": [user, other], "tweets": posts}}
record = {"userId": "1", "profile": {"screenName": "lauren"}, "lastSeen": ms(now), "days": {}, "posts": {}}
for offset, count in [(7,171000),(6,171400),(4,172000),(3,172100),(1,173800)]:
    at = ms(now - timedelta(days=offset))
    record["days"][day(now - timedelta(days=offset))] = {"first": {"at": at, "count": count}, "last": {"at": at, "count": count}}
seed = {"version": 1, "users": {"1": record}, "settings": {"recording": True, "verification": True, "media": True, "category": True, "website": True}}
binaries = sorted((Path.home() / "Library/Caches/ms-playwright").glob("chromium-*/chrome-mac-arm64/*app/Contents/MacOS/*"))
options = {"headless": True, "ignore_default_args": ["--disable-extensions"], "args": [f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"], "viewport": {"width": 1280, "height": 960}, "executable_path": str(binaries[-1])}
errors, failures, requests = [], [], []

def setup(context):
    def route(route):
        if route.request.url.startswith("chrome-extension://"):
            route.continue_()
        elif route.request.url == "https://x.com/__xfc_test":
            route.fulfill(content_type="text/html", body=(ROOT/"tests/fixture.html").read_text())
        elif "/i/api/graphql/fixture/" in route.request.url:
            route.fulfill(content_type="application/json", body=json.dumps(payload))
        else:
            route.fulfill(status=404, body="Unexpected request")
    context.route("**/*", route)
    page = context.pages[0]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("requestfailed", lambda request: failures.append(request.url))
    page.on("request", lambda request: requests.append(request.url))
    return page

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="xfc-card-") as profile:
    context = p.chromium.launch_persistent_context(profile, **options)
    page = setup(context)
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    worker.evaluate("seed => chrome.storage.local.set({'xfc-history-v1':seed})", seed)
    page.goto("https://x.com/__xfc_test")
    page.get_by_role("button", name="载入时间线").click()
    badge = page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")
    expect(badge).to_have_text("粉丝 17.4万")
    badge.hover()
    card = page.get_by_role("dialog", name="账号详情")
    expect(card).to_be_visible()
    expect(page.locator("#native-hover-card")).to_be_hidden()
    page.keyboard.press("Escape")
    page.locator("#tweet > [data-testid='User-Name'] .name-group a").hover()
    expect(page.locator("#native-hover-card")).to_be_visible()
    expect(card).to_be_hidden()
    badge.hover()
    expect(card).to_be_visible()
    expect(page.locator("#native-hover-card")).to_be_hidden()
    status = card.locator(".xfc-title-row .xfc-relation")
    expect(status).to_have_text("互相关注")
    title_bounds = card.get_by_role("heading", name="Lauren", exact=True).bounding_box()
    status_bounds = status.bounding_box()
    assert abs((title_bounds["y"] + title_bounds["height"]/2) - (status_bounds["y"] + status_bounds["height"]/2)) < 2
    expect(card.locator(".xfc-facts").get_by_text("174,000", exact=True)).to_be_visible()
    expect(card.get_by_text("544 : 1", exact=True)).to_be_visible()
    expect(card.get_by_text("1,578", exact=True)).to_be_visible()
    expect(card.get_by_text("账号自填类别", exact=True)).to_be_visible()
    expect(card.locator(".xfc-chart-section")).to_have_count(1)
    expect(card.get_by_role("heading", name="近7天已观察发帖")).to_have_count(0)
    expect(card.get_by_role("button", name="清除此账号记录")).to_have_count(0)
    expect(card.locator(".xfc-chart-caption, .xfc-chart-detail, .xfc-footnote, .xfc-range")).to_have_count(0)
    expect(card.locator(".xfc-bar")).to_have_count(5)
    columns = card.locator(".xfc-bar-column")
    assert columns.first.get_attribute("data-day") == day(now - timedelta(days=6)), "First observed day belongs on the left"
    assert columns.nth(1).get_attribute("data-count") is None, "An unobserved day must stay blank, never zero"
    expect(columns.first.locator(".xfc-bar-value")).to_have_text("171,400")
    expect(columns.last.locator(".xfc-bar-value")).to_have_text("174,000")
    assert card.locator(".xfc-bar").first.evaluate("e => e.getBoundingClientRect().height") < card.locator(".xfc-bar").last.evaluate("e => e.getBoundingClientRect().height")
    for value in card.locator(".xfc-bar-value").all():
        assert value.evaluate("e => e.scrollWidth <= e.clientWidth"), "Exact counts must fit on one line"
    before = card.inner_text()
    page.locator("#tweet [data-xfc-kind='new']").hover()
    expect(card).to_be_visible()
    assert card.inner_text() == before, "Every label must open identical details"
    page.screenshot(path=str(RESULTS/"card-light.png"))
    expect(card.locator(".xfc-bars")).to_have_attribute("role", "img")
    badge.press("Enter")
    expect(card).to_be_visible()
    page.keyboard.press("Escape")
    expect(card).to_be_hidden()
    page.get_by_role("button", name="切换深色").click()
    badge.hover()
    expect(card).to_be_visible()
    expect(page.locator("html")).to_have_attribute("data-xfc-theme", "dark")
    assert card.evaluate("e => getComputedStyle(e).backgroundColor") == "rgb(23, 33, 43)"
    page.screenshot(path=str(RESULTS/"card-dark.png"))
    page.keyboard.press("Escape")
    page.get_by_role("button", name="切换深色").click()
    page.set_viewport_size({"width":320,"height":720})
    badge.focus()
    expect(card).to_be_visible()
    bounds = card.bounding_box()
    assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 320 and bounds["y"] + bounds["height"] <= 720
    assert card.evaluate("e => e.scrollWidth <= e.clientWidth")
    for value in card.locator(".xfc-bar-value").all():
        assert value.evaluate("e => e.scrollWidth <= e.clientWidth")
    page.screenshot(path=str(RESULTS/"card-mobile.png"))
    page.keyboard.press("Escape")
    page.set_viewport_size({"width":1280,"height":960})
    # Page refresh and browser restart preserve the daily follower history.
    page.get_by_role("button", name="载入用户列表").click()
    page.reload()
    page.get_by_role("button", name="载入时间线").click()
    badge.hover()
    expect(card.locator(".xfc-bar-value").last).to_have_text("174,000")
    saved = worker.evaluate("() => chrome.storage.local.get('xfc-history-v1')")
    assert "posts" not in saved["xfc-history-v1"]["users"]["1"]
    assert "profile" not in saved["xfc-history-v1"]["users"]["1"], "Removed post statistics must no longer collect posts"
    assert "Do not persist" not in json.dumps(saved)
    assert "following\"" not in json.dumps(saved), "Viewer-specific relations must not persist"
    browser_version = context.browser.version
    context.close()
    # Restart the actual browser against the same profile, not just the DOM.
    context = p.chromium.launch_persistent_context(profile, **options)
    page = setup(context)
    page.goto("https://x.com/__xfc_test")
    page.get_by_role("button", name="载入时间线").click()
    badge = page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")
    card = page.get_by_role("dialog", name="账号详情")
    badge.hover()
    expect(card.locator(".xfc-bar")).to_have_count(5)
    expect(card.locator(".xfc-bar-value").last).to_have_text("174,000")
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    # A user with zero following has no infinite ratio and explicitly known no relation.
    page.keyboard.press("Escape")
    page.locator("#quote .xfc-badge").hover()
    expect(card.get_by_text("未关注任何账号", exact=True)).to_be_visible()
    expect(card.get_by_text("双方未关注", exact=True)).to_be_visible()
    # A first-day zero is shown explicitly at the far left, without hover.
    expect(card.locator(".xfc-bar-column")).to_have_count(1)
    expect(card.locator(".xfc-bar-value")).to_have_text("0")
    expect(card.locator(".xfc-bar-date")).to_have_text(day(now)[5:].replace("-", "/"))
    assert card.locator(".xfc-bar").evaluate("e => e.getBoundingClientRect().height") == 0
    expect(card.locator(".xfc-bars")).to_have_attribute("aria-label", f"近7天粉丝趋势，北京时间；{day(now)}：0位粉丝")
    page.screenshot(path=str(RESULTS/"card-first-day.png"))
    # Settings and all-record clearing are exercised through the actual extension page.
    extension_id = worker.url.split('/')[2]
    popup = context.new_page()
    popup.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    popup.on("pageerror", lambda error: errors.append(str(error)))
    popup.on("requestfailed", lambda req: failures.append(req.url))
    popup.goto(f"chrome-extension://{extension_id}/popup.html")
    expect(popup.locator("#summary")).to_contain_text("已记录")
    expect(popup.get_by_label("媒体帖数", exact=True)).to_be_checked()
    popup.get_by_label("媒体帖数", exact=True).uncheck()
    expect(popup.get_by_role("status")).to_have_text("已保存")
    popup.get_by_role("button", name="清除全部趋势记录", exact=True).click()
    popup.get_by_role("button", name="确认清除", exact=True).click()
    expect(popup.get_by_role("status")).to_contain_text("全部趋势记录已清除")
    expect(popup.locator("#summary")).to_contain_text("已记录 0 个账号")
    popup.screenshot(path=str(RESULTS/"popup-settings.png"))
    assert not errors, errors
    assert not failures, failures
    assert len(requests)==7, requests
    summary={"result":"passed","browser":browser_version,"checks":["native and plugin hover cards stay separate","relationship badge beside name and rounded ratio","identical hover card across labels","precise profile facts and zero following","post statistics and collection removed","bar labels, gaps and first observation at left","zero shown without hover","keyboard","light/dark/320px","page reload and real browser restart","no post body or relationships in storage","single clear removed, all clear works","optional settings","no additional network request"],"page_errors":errors,"failed_requests":failures,"requests":requests}
    (RESULTS/"card-browser-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    context.close()
