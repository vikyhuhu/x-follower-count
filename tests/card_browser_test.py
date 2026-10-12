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
    expect(card.get_by_text("544:1", exact=True)).to_be_visible()
    expect(card.locator(".xfc-ratio-pill")).to_have_text("544:1")
    expect(card.locator(".xfc-ratio-pill")).to_have_css("border-top-width", "1px")
    expect(card.get_by_text("1,578", exact=True)).to_be_visible()
    expect(card.get_by_text("专业账号类别", exact=True)).to_be_visible()
    labels = card.locator(".xfc-facts dt").all_text_contents()
    assert labels[labels.index("总发帖数") + 1] == "含图片/视频的帖数"
    media_label = card.locator("dt").filter(has_text="含图片/视频的帖数")
    expect(media_label.locator("xpath=following-sibling::dd[1]")).to_have_text("45（3%）")
    assert media_label.evaluate("e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) + 1"), "Media label must fit on one line"

    expect(card.locator(".xfc-chart-section")).to_have_count(1)
    expect(card.get_by_role("heading", name="近7天已观察发帖")).to_have_count(0)
    expect(card.get_by_role("button", name="清除此账号记录")).to_have_count(0)
    expect(card.locator(".xfc-chart-caption, .xfc-chart-detail, .xfc-footnote, .xfc-range")).to_have_count(0)
    expect(card.locator(".xfc-bar")).to_have_count(5)
    expect(card.locator(".xfc-trend-summary")).to_have_text("▲2,600（幅度1.52%）")
    columns = card.locator(".xfc-bar-column")
    assert columns.first.get_attribute("data-day") == day(now - timedelta(days=6)), "First observed day belongs on the left"
    assert columns.nth(1).get_attribute("data-count") is None, "An unobserved day must stay blank, never zero"
    expect(columns.first.locator(".xfc-bar-value")).to_have_text("171,400")
    expect(columns.last.locator(".xfc-bar-value")).to_have_text("174,000")
    assert card.locator(".xfc-bar").last.evaluate("e => e.getBoundingClientRect().height") - card.locator(".xfc-bar").first.evaluate("e => e.getBoundingClientRect().height") > 60, "Small relative changes must still be visually distinct"
    for value in card.locator(".xfc-bar-value").all():
        assert value.evaluate("e => e.scrollWidth <= e.clientWidth"), "Exact counts must fit on one line"
    before = card.inner_text()
    page.locator("#tweet [data-xfc-kind='new']").hover()
    expect(card).to_be_visible()
    assert card.inner_text() == before, "Every label must open identical details"
    assert page.locator("#tweet > [data-testid='User-Name'] .xfc-metadata > span").all_text_contents() == ["互相关注", "新号"]
    for kind in ["mutual"]:
        trigger=page.locator(f"#tweet > [data-testid='User-Name'] [data-xfc-kind='{kind}']")
        trigger.hover();expect(card).to_be_visible()
        assert card.inner_text() == before, "Relationship labels must open the same card"
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
    assert media_label.evaluate("e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) + 1"), "Media label must stay on one line at 320px"
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
    expect(card.locator("dt").filter(has_text="粉关比").locator("xpath=following-sibling::dd[1]")).to_have_text("0")
    expect(card.get_by_text("双方未关注", exact=True)).to_be_visible()
    # A first-day zero is shown explicitly at the far left, without hover.
    expect(card.locator(".xfc-bar-column")).to_have_count(1)
    expect(card.locator(".xfc-bar-value")).to_have_text("0")
    expect(card.locator(".xfc-bar-date")).to_have_text(day(now)[5:].replace("-", "/"))
    expect(card.locator(".xfc-trend-summary")).to_have_count(0)
    expect(card.locator(".xfc-history-note")).to_have_text("目前仅1天记录，后续浏览时继续积累")
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
    expect(popup.get_by_label("含图片/视频的帖数", exact=True)).to_be_checked()
    popup.get_by_label("含图片/视频的帖数", exact=True).uncheck()
    expect(popup.get_by_role("status")).to_have_text("已保存")
    popup.get_by_role("button", name="清除全部趋势记录", exact=True).click()
    popup.get_by_role("button", name="确认清除", exact=True).click()
    expect(popup.get_by_role("status")).to_contain_text("全部趋势记录已清除")
    expect(popup.locator("#summary")).to_contain_text("已记录 0 个账号")
    popup.screenshot(path=str(RESULTS/"popup-settings.png"))
    assert not errors, errors
    assert not failures, failures
    # Loaded followers/following values drive detail ratios without external labels.
    ratio_value=card.locator("dt").filter(has_text="粉关比").locator("xpath=following-sibling::dd[1]")
    for followers, following, expected in [(8,10,"0.8:1"),(1,3,"0.3:1"),(0,10,"0.0:1"),(10,10,"1:1"),(659,10,"66:1"),(100,0,"0"),(None,0,"0"),(None,10,"—"),(10,None,"—")]:
        case={"rest_id":"99","core":{"screen_name":"Lauren","name":"Lauren"},"relationship_perspectives":{"following":True,"followed_by":True},"relationship_counts":{key:value for key,value in [("followers",followers),("following",following)] if value is not None}}
        payload["data"]["users"]=[case,other]
        # Fresh page prevents absent fields from retaining a previously observed count.
        page.reload();page.get_by_role("button",name="载入时间线").click()
        page.locator('#tweet [data-xfc-kind=mutual]').click()
        expect(ratio_value).to_have_text(expected)
        expect(page.locator('[data-xfc-kind=ratio]')).to_have_count(0)
    assert not errors, errors
    assert not failures, failures
    assert len(requests)==25, requests
    context.close()
    # Fresh real-extension profiles exercise rising, falling, flat and zero-base
    # histories without modifying production state or inferring missing days.
    scenarios = [
        ("rise", [16835,16891,16956], 8769,1581, "▲121（幅度0.72%）", "up", "1,581（18%）"),
        ("fall", [16956,None,16835], 8769,1581, "▼121（幅度0.71%）", "down", "1,581（18%）"),
        ("flat", [16835,16835,16835], 8769,0, "持平（幅度0.00%）", "flat", "0（0%）"),
        ("zero-base", [0,None,5], 0,0, "▲5（幅度—）", "up", "0"),
        ("zero-flat", [0,None,0], None,5, "持平（幅度0.00%）", "flat", "5"),
        ("to-zero", [5,None,0], 10,2, "▼5（幅度100.00%）", "down", "2（20%）"),
    ]
    for name, counts, total, media, expected, trend, expected_media in scenarios:
        with tempfile.TemporaryDirectory(prefix=f"xfc-trend-{name}-") as scenario_profile:
            context = p.chromium.launch_persistent_context(scenario_profile, **options)
            page = setup(context)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            scenario_seed = {"version":1,"users":{"1":{"userId":"1","lastSeen":ms(now),"days":{}}},"settings":seed["settings"]}
            for offset, count in enumerate(counts[:-1]):
                if count is None:
                    continue
                date = now - timedelta(days=2-offset)
                snapshot = {"at":ms(date),"count":count}
                scenario_seed["users"]["1"]["days"][day(date)] = {"first":snapshot,"last":snapshot}
            worker.evaluate("seed => chrome.storage.local.set({'xfc-history-v1':seed})", scenario_seed)
            case = json.loads(json.dumps(user))
            case["relationship_counts"]["followers"] = counts[-1]
            case["tweet_counts"] = {"media_tweets":media, **({"tweets":total} if total is not None else {})}
            payload["data"]["users"] = [case,other]
            page.goto("https://x.com/__xfc_test")
            page.get_by_role("button", name="载入时间线").click()
            page.locator("#tweet > [data-testid='User-Name'] .xfc-badge").focus()
            card = page.get_by_role("dialog", name="账号详情")
            expect(card.locator(".xfc-trend-summary")).to_have_text(expected)
            expect(card.locator(".xfc-chart-section")).to_have_attribute("data-trend", trend)
            expect(card.locator(".xfc-trend-icon")).to_have_count(0 if trend == "flat" else 1)
            expect(card.locator("dt").filter(has_text="含图片/视频的帖数").locator("xpath=following-sibling::dd[1]")).to_have_text(expected_media)
            heights = card.locator(".xfc-bar").evaluate_all("bars => bars.map(e => e.getBoundingClientRect().height)")
            assert all(0 <= height <= 84 for height in heights), heights
            if name in ["rise","fall"]:
                assert abs(heights[-1] - heights[0]) > 60, heights
                expect(card.locator(".xfc-chart-scale")).to_have_text("按本账号数值范围缩放")
                color = "rgb(196, 44, 58)" if trend == "up" else "rgb(23, 116, 67)"
                assert card.locator(".xfc-trend-summary").evaluate("e => getComputedStyle(e).color") == color
                assert card.locator(".xfc-bar").first.evaluate("e => getComputedStyle(e).backgroundColor") == color
            if name == "flat":
                assert max(heights) == min(heights)
            if name == "fall":
                assert card.locator(".xfc-bar-column").nth(1).get_attribute("data-count") is None
                page.screenshot(path=str(RESULTS/"trend-fall.png"))
            if name == "rise":
                # The full card fits the viewport even when it cannot fit on
                # either side of a middle/lower trigger. Never shrink to one side.
                trigger = page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")
                for top in [460,740]:
                    trigger.evaluate("(e, top) => Object.assign(e.style, {position:'fixed', top:top+'px', left:'520px'})", top)
                    trigger.press("Enter")
                    expect(card).to_have_css("max-height", "944px")
                    layout = card.evaluate("e => ({fits:e.scrollHeight <= e.clientHeight, top:e.getBoundingClientRect().top, bottom:e.getBoundingClientRect().bottom})")
                    assert layout["fits"] and layout["top"] >= 8 and layout["bottom"] <= 952, layout
                trigger.evaluate("e => { e.style.position=''; e.style.top=''; e.style.left=''; }")
                trigger.press("Enter")
                page.screenshot(path=str(RESULTS/"trend-rise.png"))
                for width in [320,390]:
                    page.set_viewport_size({"width":width,"height":720})
                    expect(card).to_have_css("width", f"{min(320, width-16)}px")
                    bounds = card.bounding_box()
                    assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width
                    assert card.evaluate("e => e.scrollWidth <= e.clientWidth")
                    for value in card.locator(".xfc-trend-summary, .xfc-bar-value").all():
                        assert value.evaluate("e => e.scrollWidth <= e.clientWidth")
                    page.screenshot(path=str(RESULTS/f"trend-rise-{width}.png"))
                page.keyboard.press("Escape")
                expect(card).to_be_hidden()
                page.get_by_role("button", name="切换深色").click()
                expect(page.locator("html")).to_have_attribute("data-xfc-theme", "dark")
                page.locator("#tweet > [data-testid='User-Name'] .xfc-badge").press("Enter")
                expect(card).to_be_visible()
                expect(card.locator(".xfc-trend-summary")).to_have_css("color", "rgb(255, 136, 145)")
                expect(card.locator(".xfc-ratio-pill")).to_have_css("color", "rgb(139, 208, 250)")
                page.screenshot(path=str(RESULTS/"trend-rise-dark.png"))
                page.set_viewport_size({"width":320,"height":360})
                expect(card).to_have_css("max-height", "344px")
                assert card.evaluate("e => e.scrollHeight > e.clientHeight && e.getBoundingClientRect().top >= 8 && e.getBoundingClientRect().bottom <= 352"), "A viewport shorter than the card must remain scrollable"
                page.keyboard.press("Escape")
                expect(card).to_be_hidden()
            context.close()
    assert not errors, errors
    assert not failures, failures
    summary={"result":"passed","browser":browser_version,"checks":["native and plugin hover cards stay separate","text relationship badges restored, ratio only in details", "ratio below one has one decimal, zero following is zero, missing stays unknown","identical hover card across labels","precise profile facts and zero following","media share rounded; zero and missing total omit percentage","small follower changes visibly scaled against own range","first/last net change and percentage; red rise and green fall","flat and zero-base histories","post statistics and collection removed","bar labels, gaps and first observation at left","zero shown without hover","keyboard","light/dark/320px/390px","page reload and real browser restart","no post body or relationships in storage","single clear removed, all clear works","optional settings","no additional network request"],"page_errors":errors,"failed_requests":failures,"requests":requests}
    (RESULTS/"card-browser-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps(summary,ensure_ascii=False,indent=2))
