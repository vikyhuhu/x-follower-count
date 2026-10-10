"""Load the actual MV3 extension in an isolated browser using synthetic X responses.

No request is sent to X and no existing Chrome profile is used.
Requires Python Playwright and a Chromium binary; see README.
"""
import json
import os
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
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
        assert "174,000" in page.locator("#tweet > [data-testid='User-Name'] .xfc-badge").get_attribute("title")
        alignment = page.locator("#tweet > [data-testid='User-Name'] .xfc-name-row").evaluate("""row => {
          const link = row.querySelector('a').getBoundingClientRect();
          const badge = row.querySelector('.xfc-badge').getBoundingClientRect();
          return {row: getComputedStyle(row).flexDirection, nameY: link.y + link.height/2, badgeY: badge.y + badge.height/2, nameRight: link.right, badgeLeft: badge.left};
        }""")
        assert alignment["row"] == "row" and abs(alignment["nameY"] - alignment["badgeY"]) < 2
        assert alignment["badgeLeft"] >= alignment["nameRight"]

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
        page.evaluate("""() => document.querySelectorAll('#dynamic a').forEach(a => {
          a.href = '/Unknown'; a.textContent = a.classList.contains('handle') ? '@Unknown' : 'Unknown';
        })""")
        expect(page.locator("#dynamic .xfc-badge")).to_have_count(0)
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

        # Keyboard focus stays on the site's links; labels add no extra tab stops.
        first_link = page.locator("#tweet > [data-testid='User-Name'] a").first
        first_link.focus()
        expect(first_link).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.locator("#tweet > [data-testid='User-Name'] .handle")).to_be_focused()
        page.screenshot(path=str(RESULTS / "desktop-light.png"), full_page=True)
        page.get_by_role("button", name="切换深色").click()
        expect(page.locator("html")).to_have_attribute("data-xfc-theme", "dark")
        assert page.locator(".xfc-badge").first.evaluate("e => getComputedStyle(e).color") == "rgb(139, 208, 250)"
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
        page.screenshot(path=str(RESULTS / "mobile-light.png"), full_page=True)

        # Switching an SPA route keeps the cache and triggers new cards correctly.
        page.evaluate("""() => {
          history.pushState({}, '', '/example/followers');
          const node = document.querySelector('#alice').cloneNode(true);
          node.id = 'spa'; node.querySelectorAll('.xfc-badge').forEach(n => n.remove());
          document.querySelector('section').append(node);
        }""")
        expect(page.locator("#spa .xfc-badge")).to_have_text("粉丝 7,806")
        assert not errors, errors
        assert not failures, failures
        assert len(requests) == 6, f"Unexpected additional requests: {requests}"
        summary = {
            "result": "passed", "browser": context.browser.version,
            "mode": "actual unpacked MV3 extension, synthetic X page and API responses",
            "checks": ["fetch", "XHR", "original response body", "old/new user shapes", "zero", "missing count", "nested quote", "nested UserCell", "dynamic append", "virtualized user reuse", "count update", "non-API response", "invalid JSON", "message validation", "keyboard", "desktop light/dark", "390px mobile long name", "SPA navigation", "no additional API request"],
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
