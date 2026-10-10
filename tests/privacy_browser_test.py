"""Fresh defaults, saved choices, storage minimization and real extension reload."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
EXTENSION = Path(os.environ.get("EXTENSION_UNDER_TEST", str(ROOT/"extension")))
binaries = sorted((Path.home()/"Library/Caches/ms-playwright").glob("chromium-*/chrome-mac-arm64/*app/Contents/MacOS/*"))
payload = {"rest_id":"1","core":{"screen_name":"Lauren","name":"Lauren"},"relationship_counts":{"followers":100,"following":5},"relationship_perspectives":{"following":True,"followed_by":True}}
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="xfc-privacy-") as profile:
    context=p.chromium.launch_persistent_context(profile,headless=True,executable_path=os.environ.get("CHROMIUM_EXECUTABLE",str(binaries[-1])),ignore_default_args=["--disable-extensions"],args=[f"--disable-extensions-except={EXTENSION}",f"--load-extension={EXTENSION}"])
    def route(r):
        if r.request.url.startswith("chrome-extension://"):r.continue_()
        elif r.request.url=="https://x.com/__xfc_test":r.fulfill(content_type="text/html",body=(ROOT/"tests/fixture.html").read_text())
        elif "/i/api/graphql/fixture/" in r.request.url:r.fulfill(content_type="application/json",body=json.dumps(payload))
        else:r.fulfill(status=404)
    context.route("**/*",route)
    page=context.pages[0];errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.goto("https://x.com/__xfc_test");page.get_by_role("button",name="载入时间线").click()
    badge=page.locator("#tweet > [data-testid='User-Name'] .xfc-badge")
    expect(badge).to_have_text("粉丝 100")
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    extension_id=worker.url.split('/')[2]
    popup=context.new_page();popup.goto(f"chrome-extension://{extension_id}/popup.html")
    for label in ["开启本机粉丝趋势记录","认证状态","含图片/视频的帖数","专业账号类别","个人网站"]:
        expect(popup.get_by_label(label,exact=True)).to_be_checked()
    expect(popup.locator("fieldset .note")).to_contain_text("新安装默认开启")
    badge.hover();expect(page.locator('.xfc-bar-value')).to_have_text('100')
    saved=worker.evaluate("()=>chrome.storage.local.get('xfc-history-v1')")['xfc-history-v1']
    assert sorted(saved['users']['1'])==['days','lastSeen','userId']
    popup.get_by_label("个人网站",exact=True).uncheck()
    expect(popup.get_by_role("status")).to_have_text("已保存")
    popup.get_by_label("开启本机粉丝趋势记录",exact=True).uncheck()
    expect(popup.get_by_role("status")).to_have_text("已保存")
    payload['relationship_counts']['followers']=101
    page.get_by_role("button",name="载入时间线").click();expect(badge).to_have_text('粉丝 101')
    badge.hover();expect(page.locator('.xfc-bar')).to_have_count(0)
    current=worker.evaluate("()=>chrome.storage.local.get('xfc-history-v1')")['xfc-history-v1']
    assert current['users']==saved['users']
    popup.get_by_role('button',name='清除全部趋势记录',exact=True).click()
    popup.get_by_role('button',name='确认清除',exact=True).click()
    expect(popup.locator('#summary')).to_contain_text('已记录 0 个账号')
    privacy=context.new_page();privacy.goto(f"chrome-extension://{extension_id}/privacy.html")
    expect(privacy.get_by_role('heading',name='X 粉丝数隐私政策',exact=True)).to_be_visible()
    expect(privacy.locator("body")).to_contain_text("新安装默认开启")
    # Reload from Chrome's real extension manager while the old X page stays alive.
    manager=context.new_page();manager.goto('chrome://extensions')
    toggle=manager.locator('#devMode');toggle.click()
    item=manager.locator('extensions-item').filter(has_text='X 粉丝数')
    expect(item).to_have_count(1)
    item.locator('#dev-reload-button').click()
    # Old isolated listeners should exit safely on a bridge message / DOM change.
    page.evaluate("() => {window.postMessage({channel:'x-follower-count:v1',type:'bridge-ready'},location.origin); document.body.append(document.createElement('div'));}")
    expect(page.locator('.xfc-labels')).to_have_count(0)
    assert not errors,errors
    page.reload();page.get_by_role('button',name='载入时间线').click()
    expect(page.locator("#tweet .xfc-badge")).to_have_text('粉丝 101')
    popup=context.new_page();popup.goto(f"chrome-extension://{extension_id}/popup.html")
    expect(popup.get_by_label("开启本机粉丝趋势记录",exact=True)).not_to_be_checked()
    expect(popup.get_by_label("个人网站",exact=True)).not_to_be_checked()
    page.locator("#tweet .xfc-badge").hover();expect(page.locator('.xfc-bar')).to_have_count(0)
    assert not errors,errors
    print(json.dumps({'result':'passed','checks':['fresh install defaults all five options on and records first observation','popup discloses recording','disabled choices persist through real extension reload','minimal storage schema','disable and clear','offline privacy','real extension reload safely stops old listeners','new page resumes'],'page_errors':errors},ensure_ascii=False))
    context.close()
