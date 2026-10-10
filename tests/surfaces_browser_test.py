"""Exercise cold page loads and X-shaped list layouts with the actual MV3 extension."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = Path(os.environ.get("EXTENSION_UNDER_TEST", str(ROOT / "extension")))
RESULTS = ROOT / "test-results"
RESULTS.mkdir(exist_ok=True)
binaries = sorted((Path.home() / "Library/Caches/ms-playwright").glob("chromium-*/chrome-mac-arm64/*app/Contents/MacOS/*"))
binary = os.environ.get("CHROMIUM_EXECUTABLE") or (str(binaries[-1]) if binaries else None)
payload = {"data": {"entries": [{"user_results": {"result": {
    "rest_id": "123", "core": {"screen_name": "ListUser", "created_at": "2010-08-10T05:49:46Z"},
    "relationship_counts": {"followers": 116000, "following": 80},
    "relationship_perspectives": {"following": True, "followed_by": True}
}}}]}}
errors, failures, requests = [], [], []
recommendation_scenario = False
def account(handle, count):
    return {"rest_id": str(count), "core": {"screen_name": handle, "created_at": "2020-01-01T00:00:00Z"},
            "relationship_counts": {"followers": count}}
recommendation_payloads = {
    "SidebarUserRecommendations": {"data": {"users": [account("SharedUser", 432)]}},
    "ExplorePage": {"data": {"users": [account("MainOne", 1574), account("SharedUser", 432), account("MainTwo", 116000)]}},
    "UserRepliesTimeline": {"data": {"users": [account("NewUser", 999)]}},
}
operations = ["ExplorePage", "ConnectTabTimeline", "UserOriginalsTimeline", "UserRepliesTimeline",
              "UserRepostsTimeline", "UserArticlesTweets", "Bookmarks", "Likes", "Following"]

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="xfc-surfaces-") as profile:
    options = {
        "headless": True, "ignore_default_args": ["--disable-extensions"],
        "args": [f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"],
        "viewport": {"width": 1280, "height": 960},
    }
    if binary:
        options["executable_path"] = binary
    else:
        options["channel"] = "chromium"
    context = p.chromium.launch_persistent_context(profile, **options)
    page = context.pages[0]
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("requestfailed", lambda r: failures.append(r.url))

    def route_request(route):
        if route.request.url.startswith("chrome-extension://"):
            route.continue_()
        elif route.request.url.startswith("https://x.com/__xfc_surfaces?"):
            route.fulfill(content_type="text/html", body=(ROOT / "tests/surfaces_fixture.html").read_text())
        elif "/i/api/graphql/fixture/" in route.request.url:
            requests.append(route.request.url)
            operation = route.request.url.rsplit("/", 1)[-1]
            response = recommendation_payloads[operation] if recommendation_scenario else payload
            route.fulfill(content_type="application/json", body=json.dumps(response))
        else:
            route.fulfill(status=404, body="Unexpected request")

    context.route("**/*", route_request)

    def assert_list_geometry():
        for selector in ["#compact", "#full", "#nested"]:
            geometry = page.locator(selector).evaluate("""cell => {
                const name = cell.querySelector('.native-name a');
                const handle = cell.querySelector('.native-handle a');
                const row = cell.querySelector('.xfc-labels');
                const box = e => e.getBoundingClientRect();
                const n = box(name), h = box(handle), r = box(row);
                const button = box(cell.querySelector('button'));
                return {nameFits: name.scrollWidth <= name.clientWidth + 1,
                    handleFits: handle.scrollWidth <= handle.clientWidth + 1,
                    stacked: h.top >= n.bottom - 1, labelsBelow: r.top >= h.bottom,
                    labelsBeforeButton: r.right <= button.left,
                    labelsFit: [...row.querySelectorAll('.xfc-badge,.xfc-meta-badge')].every(e => {
                        const b = box(e); return b.left >= r.left - 1 && b.right <= r.right + 1;
                    }), viewportFit: cell.scrollWidth <= cell.clientWidth + 1};
            }""")
            assert all(geometry.values()), (selector, geometry)

    try:
        for operation in operations:
            page.goto(f"https://x.com/__xfc_surfaces?operation={operation}")
            # A full navigation resets page-memory caches: these labels cannot be inherited.
            expect(page.get_by_role("heading", name="合成账号列表")).to_be_visible()
            expect(page.locator(".xfc-labels")).to_have_count(0)
            page.get_by_role("button", name="载入当前页面").click()
            expect(page.locator(".xfc-labels")).to_have_count(4)
            for selector in ["#compact", "#full", "#nested", "#author"]:
                expect(page.locator(selector + " .xfc-badge")).to_have_text("粉丝 11.6万")
                expect(page.locator(selector + " [data-xfc-kind='mutual']")).to_have_text("互相关注")
                expect(page.locator(selector + " [data-xfc-kind='age']")).to_be_visible()
            for width in [1280, 390, 320]:
                page.set_viewport_size({"width": width, "height": 960})
                assert_list_geometry()
            page.set_viewport_size({"width": 1280, "height": 960})

        # Labels wrap individually in a narrow card without taking width from identity.
        page.locator("#compact .xfc-badge").focus()
        expect(page.get_by_role("dialog", name="账号详情")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog", name="账号详情")).to_be_hidden()
        for theme in ["light", "dark"]:
            page.evaluate("theme => document.body.classList.toggle('dark', theme === 'dark')", theme)
            expect(page.locator("html")).to_have_attribute("data-xfc-theme", theme)
            assert_list_geometry()
            page.screenshot(path=str(RESULTS / f"surfaces-{theme}.png"), full_page=True)
        page.set_viewport_size({"width": 320, "height": 960})
        assert_list_geometry()
        page.screenshot(path=str(RESULTS / "surfaces-mobile.png"), full_page=True)

        # Reproduce the real gap: sidebar overlap makes only one main recommendation appear supported.
        recommendation_scenario = True
        page.set_viewport_size({"width": 1280, "height": 960})
        page.goto("https://x.com/__xfc_surfaces?operation=SidebarUserRecommendations")
        page.evaluate("""() => {
            document.querySelector('#author').closest('article').remove();
            const third = document.querySelector('#full').cloneNode(true);
            third.id = 'third'; document.querySelector('#nested').after(third);
            for (const [id, handle] of [['compact','SharedUser'], ['full','MainOne'], ['nested','SharedUser'], ['third','MainTwo']]) {
                const cell = document.getElementById(id);
                cell.querySelector('.native-name a').textContent = handle;
                cell.querySelector('.native-handle a').textContent = '@' + handle;
                for (const link of cell.querySelectorAll('.native-name a,.native-handle a')) link.href = '/' + handle;
            }
        }""")
        expect(page.locator(".xfc-labels")).to_have_count(0)
        page.get_by_role("button", name="载入当前页面").click()
        expect(page.locator(".xfc-labels")).to_have_count(2)
        expect(page.locator("#full .xfc-labels")).to_have_count(0)
        expect(page.locator("#third .xfc-labels")).to_have_count(0)
        page.evaluate("() => fetch('/i/api/graphql/fixture/ExplorePage').then(r => r.json())")
        expect(page.locator(".xfc-labels")).to_have_count(4)
        for selector, text in [("#full", "粉丝 1,574"), ("#nested", "粉丝 432"), ("#third", "粉丝 11.6万")]:
            expect(page.locator(selector + " .xfc-badge")).to_have_text(text)
            expect(page.locator(selector + " [data-xfc-kind='age']")).to_be_visible()

        # SPA navigation can recycle a card, then load another response or append a card later.
        page.evaluate("""() => {
            const cell = document.querySelector('#full');
            cell.querySelector('.native-name a').textContent = 'NewUser';
            cell.querySelector('.native-handle a').textContent = '@NewUser';
            for (const link of cell.querySelectorAll('.native-name a,.native-handle a')) link.href = '/NewUser';
        }""")
        expect(page.locator("#full .xfc-labels")).to_have_count(0)
        page.evaluate("() => fetch('/i/api/graphql/fixture/UserRepliesTimeline').then(r => r.json())")
        expect(page.locator("#full .xfc-badge")).to_have_text("粉丝 999")
        page.evaluate("""() => {
            const card = document.querySelector('#third').cloneNode(true);
            card.id = 'late'; card.querySelector('.xfc-labels').remove();
            document.querySelector('#third').after(card);
        }""")
        expect(page.locator("#late .xfc-badge")).to_have_text("粉丝 11.6万")
        assert not errors, errors
        assert not failures, failures
        assert len(requests) == len(operations) + 3, requests
        print(json.dumps({"result": "passed", "operations": operations,
                          "checks": ["cold cache", "independent main/sidebar recommendations", "SPA recycled and late cards", "stacked readable identity", "wrapped list metadata", "nested header", "320/390/1280px", "keyboard card", "light/dark", "no extra requests"],
                          "page_errors": errors, "failed_requests": failures}, ensure_ascii=False))
    finally:
        context.close()
