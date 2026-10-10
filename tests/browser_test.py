"""Load the actual MV3 extension in an isolated browser using synthetic X responses.

No request is sent to X and no existing Chrome profile is used.
Requires Python Playwright and a Chromium binary; see README.
"""
import json
import os
import tempfile
import calendar
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = Path(os.environ.get("EXTENSION_UNDER_TEST", str(ROOT / "extension")))
RESULTS = ROOT / "test-results"
RESULTS.mkdir(exist_ok=True)
PAYLOAD = {"data": {"entries": [
    {"user_results": {"result": {"__typename": "User", "core": {"screen_name": "Lauren"}, "relationship_counts": {"followers": 174000, "following": 100}}}},
    {"core": {"screen_name": "Tim"}, "legacy": {"followers_count": 11000}},
    {"core": {"screen_name": "Alice"}, "relationship_counts": {"followers": 1574, "following": 77}},
    {"core": {"screen_name": "Zero"}, "relationship_counts": {"followers": 0, "following": 99}},
    {"legacy": {"screen_name": "Unknown", "friends_count": 100}},
    {"screen_name": "Metrics", "public_metrics": {"followers_count": 22}},
]}}

# Dates are relative to the actual test run; exact 90-day boundary is covered in Node.
now = datetime.now(timezone.utc)
def created(days):
    return (now - timedelta(days=days)).strftime("%a %b %d %H:%M:%S +0000 %Y")
def created_months(months):
    index = now.year * 12 + now.month - 1 - months
    year, month_index = divmod(index, 12)
    month = month_index + 1
    return now.replace(year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1])).strftime("%a %b %d %H:%M:%S +0000 %Y")
PAYLOAD["data"]["entries"][0]["user_results"]["result"].update({"relationship_perspectives": {"following": True, "followed_by": True}})
PAYLOAD["data"]["entries"][0]["user_results"]["result"]["core"]["created_at"] = created(89)
PAYLOAD["data"]["entries"][1]["legacy"].update({"following": False, "followed_by": True, "created_at": created_months(8)})
PAYLOAD["data"]["entries"][2]["relationship_perspectives"] = {"following": True, "followed_by": False}
PAYLOAD["data"]["entries"][2]["core"]["created_at"] = created(2)
PAYLOAD["data"]["entries"][3]["relationship_perspectives"] = {"following": False, "followed_by": False}
PAYLOAD["data"]["entries"][3]["core"]["created_at"] = created(-1)
PAYLOAD["data"]["entries"][4]["legacy"].update({"followed_by": True, "created_at": "invalid"})
PAYLOAD["data"]["entries"][5]["created_at"] = created_months(44)


def browser_binary():
    configured = os.environ.get("CHROMIUM_EXECUTABLE")
    if configured:
        return configured
    candidates = sorted((Path.home() / "Library/Caches/ms-playwright").glob("chromium-*/chrome-mac-arm64/*app/Contents/MacOS/*"))
    return str(candidates[-1]) if candidates else None


with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="xfc-browser-") as profile:
    options = {
        "headless": True,
        "ignore_default_args": ["--disable-extensions"],
        "args": [f"--disable-extensions-except={ROOT / 'extension'}", f"--load-extension={ROOT / 'extension'}"],
        "viewport": {"width": 1280, "height": 960},
        "device_scale_factor": 1,
    }
    binary = browser_binary()
    if binary:
        options["executable_path"] = binary
    else:
        options["channel"] = "chromium"
    context = playwright.chromium.launch_persistent_context(profile, **options)
    page = context.pages[0]
    errors, failures, requests = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("requestfailed", lambda request: failures.append(request.url))
    page.on("request", lambda request: requests.append(request.url))

    def route_request(route):
        url = route.request.url
        if url == "https://x.com/__xfc_test":
            route.fulfill(content_type="text/html", body=(ROOT / "tests/fixture.html").read_text())
        elif "/i/api/graphql/fixture/Broken" in url:
            # A successful HTTP response containing non-JSON is another safe failure case.
            route.fulfill(content_type="text/plain", body="not json")
        elif "/i/api/graphql/fixture/" in url:
            route.fulfill(content_type="application/json", body=json.dumps(PAYLOAD))
        elif url.endswith("/outside-api"):
            route.fulfill(content_type="application/json", body=json.dumps({"screen_name": "Unknown", "followers_count": 666}))
        else:
            route.fulfill(status=404, body="Unexpected fixture request")

    context.route("**/*", route_request)
    def assert_inline_metadata():
        geometry = page.locator(".xfc-metadata").evaluate_all("""rows => rows.map(row => {
          const previous = row.previousElementSibling;
          const a = (previous || row.parentElement).getBoundingClientRect(), b = row.getBoundingClientRect();
          return {anchor: !previous || previous.matches('.xfc-badge'), labelRow: row.parentElement.classList.contains('xfc-labels'), left: b.left, right: b.right, anchorRight: previous ? a.right : a.left, anchorY: a.y+a.height/2, rowY: b.y+b.height/2, viewport: innerWidth};
        })""")
        for item in geometry:
            assert item["anchor"] and item["labelRow"], item
            assert abs(item["anchorY"] - item["rowY"]) < 2, item
            assert item["left"] >= item["anchorRight"] and item["right"] <= item["viewport"], item

    try:
        page.goto("https://x.com/__xfc_test", wait_until="domcontentloaded")
        # Inspect the rendered page before choosing browser assertions.
        print("Fixture headings:", page.get_by_role("heading").all_text_contents())
        expect(page.locator(".xfc-badge")).to_have_count(0)
        page.get_by_role("button", name="载入时间线").click()
        expect(page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")).to_have_text("粉丝 17.4万")
        expect(page.locator("#quote .xfc-badge")).to_have_text("粉丝 1.1万")
        expect(page.locator("#alice .xfc-badge")).to_have_text("粉丝 1,574")
        expect(page.locator("#zero .xfc-badge")).to_have_text("粉丝 0")
        expect(page.locator("#unknown .xfc-badge")).to_have_count(0)
        expect(page.locator("#nested .xfc-badge")).to_have_count(1)
        expect(page.locator("#response-state")).to_have_text("页面仍能完整读取原始响应")
        expect(page.locator("#tweet > [data-testid='User-Name'] .xfc-metadata")).to_have_text("互相关注新号")
        expect(page.locator("#quote .xfc-metadata")).to_have_text("关注了你8个月")
        expect(page.locator("#alice .xfc-metadata")).to_have_text("你已关注新号")
        expect(page.locator("#zero .xfc-metadata")).to_have_count(0)
        # A known relation is displayed even if the count and opposite direction are missing.
        expect(page.locator("#unknown .xfc-metadata")).to_have_text("关注了你")
        expect(page.locator("#nested .xfc-metadata")).to_have_text("3年8个月")
        for label in page.locator(".xfc-badge, .xfc-meta-badge").all():
            assert label.get_attribute("title") is None
            assert "查看 @" in label.get_attribute("aria-label")
            assert label.get_attribute("aria-haspopup") == "dialog"
        for selector, months in [("#quote", 8), ("#nested", 44)]:
            label = page.locator(selector + " [data-xfc-kind='age']")
            assert "号龄" not in label.inner_text()
        assert_inline_metadata()
        assert "粉丝 17.4万" in page.locator("#tweet > [data-testid='User-Name'] .xfc-badge").get_attribute("aria-label")
        alignment = page.locator("#tweet > [data-testid='User-Name']").evaluate("""row => {
          const tail = row.querySelector('.tweet-time').getBoundingClientRect();
          const badge = row.querySelector('.xfc-badge').getBoundingClientRect();
          return {row: getComputedStyle(row).flexDirection, tailY: tail.y + tail.height/2, badgeY: badge.y + badge.height/2, tailRight: tail.right, badgeLeft: badge.left, inNameTrigger: !!row.querySelector('.name-group .xfc-badge')};
        }""")
        assert alignment["row"] == "row" and abs(alignment["tailY"] - alignment["badgeY"]) < 2
        assert alignment["badgeLeft"] >= alignment["tailRight"] and not alignment["inNameTrigger"]

        # Repeated requests must not duplicate badges, and XHR must preserve its body.
        page.get_by_role("button", name="载入用户列表").click()
        expect(page.locator("#response-state")).to_have_text("XHR 原始响应完整")
        expect(page.locator(".xfc-badge")).to_have_count(5)

        # A dynamically added card receives the earlier cached count.
        page.evaluate("""() => {
          const node = document.querySelector('#alice').cloneNode(true);
          node.id = 'dynamic'; node.querySelectorAll('.xfc-badge').forEach(n => n.remove());
          document.querySelector('section').append(node);
        }""")
        expect(page.locator("#dynamic .xfc-badge")).to_have_text("粉丝 1,574")

        # React-style virtualization: recycle a card for another user, then one without data.
        page.evaluate("""() => document.querySelectorAll('#dynamic a').forEach(a => {
          a.href = '/Zero'; a.textContent = a.classList.contains('handle') ? '@Zero' : 'Zero';
        })""")
        expect(page.locator("#dynamic .xfc-badge")).to_have_text("粉丝 0")
        expect(page.locator("#dynamic .xfc-metadata")).to_have_count(0)
        page.evaluate("""() => document.querySelectorAll('#dynamic a').forEach(a => {
          a.href = '/Unknown'; a.textContent = a.classList.contains('handle') ? '@Unknown' : 'Unknown';
        })""")
        expect(page.locator("#dynamic .xfc-badge")).to_have_count(0)
        expect(page.locator("#dynamic .xfc-metadata")).to_have_text("关注了你")
        page.locator("#dynamic").evaluate("node => node.remove()")

        # The page can update a known user's count in a later response.
        PAYLOAD["data"]["entries"][2]["relationship_counts"]["followers"] = 7806
        page.get_by_role("button", name="载入用户列表").click()
        expect(page.locator("#alice .xfc-badge")).to_have_text("粉丝 7,806")

        # Ignore valid-looking data outside X API paths, malformed data and cross-origin messages.
        page.evaluate("() => fetch('/outside-api').then(r => r.json())")
        page.get_by_role("button", name="失败响应").click()
        expect(page.locator("#response-state")).to_have_text("失败状态 200")
        page.evaluate("""() => {
          const bad = { channel: 'x-follower-count:v1', type: 'users', users: [{screenName:'Unknown',followersCount:-1}] };
          window.postMessage(bad, location.origin);
          window.dispatchEvent(new MessageEvent('message', {source:window, origin:'https://evil.test', data:{...bad,users:[{screenName:'Unknown',followersCount:888}]}}));
        }""")
        expect(page.locator("#unknown .xfc-badge")).to_have_count(0)

        # Keyboard can focus the plugin badge and open/close the account card.
        first_link = page.locator("#tweet > [data-testid='User-Name'] a").first
        first_link.focus()
        expect(first_link).to_be_focused()
        page.locator("#tweet > [data-testid='User-Name'] .tweet-time").focus()
        page.keyboard.press("Tab")
        expect(page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")).to_be_focused()
        expect(page.get_by_role("dialog", name="账号详情")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="账号详情")).to_be_hidden()
        page.get_by_role("heading").first.click()
        page.screenshot(path=str(RESULTS / "desktop-light.png"), full_page=True)
        page.get_by_role("button", name="切换深色").click()
        expect(page.locator("html")).to_have_attribute("data-xfc-theme", "dark")
        assert page.locator(".xfc-badge").first.evaluate("e => getComputedStyle(e).color") == "rgb(255, 197, 138)"
        page.screenshot(path=str(RESULTS / "desktop-dark.png"), full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="切换深色").click()
        # Very long author names must shrink while preserving a readable badge.
        first_link.evaluate("e => e.textContent = '这是一个用于检查移动端名称截断的特别特别长的名字'")
        expect(page.locator("html")).to_have_attribute("data-xfc-theme", "light")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile layout overflowed"
        badge = page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")
        bounds = badge.bounding_box()
        assert bounds["width"] > 50 and bounds["x"] + bounds["width"] <= 390
        assert_inline_metadata()
        page.screenshot(path=str(RESULTS / "mobile-light.png"), full_page=True)
        page.set_viewport_size({"width": 320, "height": 720})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "320px layout overflowed"
        assert_inline_metadata()
        page.screenshot(path=str(RESULTS / "mobile-320-inline.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})

        # Switching an SPA route keeps the cache and triggers new cards correctly.
        page.evaluate("""() => {
          history.pushState({}, '', '/example/followers');
          const node = document.querySelector('#alice').cloneNode(true);
          node.id = 'spa'; node.querySelectorAll('.xfc-badge').forEach(n => n.remove());
          document.querySelector('section').append(node);
        }""")
        expect(page.locator("#spa .xfc-badge")).to_have_text("粉丝 7,806")
        # Exercise every raw-count boundary through actual API responses.
        cases = [(0, "small"), (999, "small"), (1000, "thousand"),
                 (9999, "thousand"), (10000, "ten-thousand"),
                 (99999, "ten-thousand"), (100000, "hundred-thousand"),
                 (999999, "hundred-thousand"), (1000000, "million")]
        for index, (count, tier) in enumerate(cases):
            handle = f"tier{index}"
            PAYLOAD["data"]["entries"].append({"core": {"screen_name": handle}, "relationship_counts": {"followers": count}})
        page.evaluate("""cases => {
          const section = document.querySelector('section');
          cases.forEach(([count], index) => {
            const node = document.querySelector('#alice').cloneNode(true);
            node.id = 'tier' + index;
            node.querySelectorAll('.xfc-badge').forEach(n => n.remove());
            node.querySelectorAll('a').forEach(a => {
              a.href = '/tier' + index;
              a.textContent = a.classList.contains('handle') ? '@tier' + index : count.toLocaleString('en-US');
            });
            section.append(node);
          });
        }""", cases)
        page.get_by_role("button", name="载入用户列表").click()
        for index, (_, tier) in enumerate(cases):
            expect(page.locator(f"#tier{index} .xfc-badge")).to_have_attribute("data-xfc-tier", tier)

        # Text/background contrast remains readable for every tier in both themes.
        contrast_script = r"""e => {
          const style = getComputedStyle(e);
          const luminance = color => {
            const c = color.match(/\d+/g).slice(0,3).map(Number).map(v => v/255);
            const linear = c.map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
            return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
          };
          const foreground = luminance(style.color), background = luminance(style.backgroundColor);
          return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
        }"""
        for theme in ("light", "dark"):
            expect(page.locator("html")).to_have_attribute("data-xfc-theme", theme)
            for index in range(len(cases)):
                assert page.locator(f"#tier{index} .xfc-badge").evaluate(contrast_script) >= 4.5
            for label in page.locator(".xfc-meta-badge").all():
                assert label.evaluate(contrast_script) >= 4.5
                box = label.bounding_box()
                assert box["x"] >= 0 and box["x"] + box["width"] <= 390
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(RESULTS / f"tiers-{theme}.png"), full_page=True)
            page.get_by_role("button", name="切换深色").click()

        # Update a badge across a tier boundary, including a reused DOM card.
        PAYLOAD["data"]["entries"][2]["relationship_counts"]["followers"] = 10000
        page.get_by_role("button", name="载入用户列表").click()
        expect(page.locator("#alice .xfc-badge")).to_have_attribute("data-xfc-tier", "ten-thousand")
        expect(page.locator("#spa .xfc-badge")).to_have_attribute("data-xfc-tier", "ten-thousand")
        page.locator("#tier8").evaluate("node => node.querySelectorAll('a').forEach(a => {a.href='/Zero'; a.textContent='Zero';})")
        expect(page.locator("#tier8 .xfc-badge")).to_have_attribute("data-xfc-tier", "small")
        # Successful responses can change relationships without changing follower count.
        for following, followed_by, text in [(True, True, "互相关注新号"), (False, True, "关注了你新号"), (False, False, "新号")]:
            PAYLOAD["data"]["entries"][2] = {"core": {"screen_name": "Alice"}, "relationship_perspectives": {"following": following, "followed_by": followed_by}}
            page.get_by_role("button", name="载入用户列表").click()
            expect(page.locator("#alice .xfc-metadata")).to_have_text(text)
            expect(page.locator("#spa .xfc-metadata")).to_have_text(text)
            expect(page.locator("#alice .xfc-badge")).to_have_text("粉丝 1万")
        # Replacing a new-account date by an older date updates the existing inline label.
        PAYLOAD["data"]["entries"][0]["user_results"]["result"]["core"]["created_at"] = created_months(44)
        page.get_by_role("button", name="载入用户列表").click()
        expect(page.locator("#tweet > [data-testid='User-Name'] .xfc-metadata")).to_have_text("互相关注3年8个月")
        expect(page.locator("#tweet [data-xfc-kind='new']")).to_have_count(0)
        page.set_viewport_size({"width": 320, "height": 720})
        assert_inline_metadata()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(RESULTS / "mobile-320-account-age.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        # Switching the viewer invalidates page-scoped relation caches.
        page.get_by_test_id("SideNav_AccountSwitcher_Button").evaluate("e => e.textContent = '测试帐号 @AnotherViewer'")
        expect(page.locator(".xfc-badge")).to_have_count(0)
        expect(page.locator(".xfc-metadata")).to_have_count(0)
        page.get_by_role("button", name="载入用户列表").click()
        expect(page.locator("#tweet > [data-testid='User-Name'] .xfc-metadata")).to_have_text("互相关注3年8个月")
        assert not errors, errors
        assert not failures, failures
        assert len(requests) == 13, f"Unexpected additional requests: {requests}"
        summary = {
            "result": "passed", "browser": context.browser.version,
            "mode": "actual unpacked MV3 extension, synthetic X page and API responses",
            "checks": ["fetch", "XHR", "original response body", "old/new user shapes", "zero", "missing count", "nested quote", "nested UserCell", "dynamic append", "virtualized user reuse", "count update", "non-API response", "invalid JSON", "message validation", "keyboard", "desktop light/dark", "390px mobile long name", "SPA navigation", "no additional API request", "all color tier boundaries", "color update and reused card", "light/dark contrast >= 4.5", "all relation states including unknown", "relation without follower count", "new account valid/old/future/missing dates", "relation-only updates and partial response merging", "labels after handle and timestamp, outside native name trigger", "320px/390px inline metadata", "viewer switch cache reset", "month/year age labels and registration tooltip", "new-to-age label update", "clean tooltip and aria labels"],
            "page_errors": errors, "failed_requests": failures, "requests": requests,
            "not_verified": ["live logged-in X DOM/API compatibility"],
        }
        (RESULTS / "browser-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    except Exception:
        print("Page errors:", errors)
        print("Browser injection:", page.evaluate("({data:typeof globalThis.__xfcData,theme:document.documentElement.dataset.xfcTheme,fetch:String(window.fetch).slice(0,300)})"))
        raise
    finally:
        context.close()
