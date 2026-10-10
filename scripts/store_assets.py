"""Render store assets using actual extension UI and entirely synthetic accounts.

Requires the existing development Playwright runtime. No network or live profile.
"""
import base64
import json
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'assets/store'
OUT.mkdir(parents=True,exist_ok=True)
now=datetime.now(timezone.utc)
ms=lambda date:int(date.timestamp()*1000)
day=lambda date:(date+timedelta(hours=8)).strftime('%Y-%m-%d')
counts=[6378,17000,423]
handles=['demo_creator','demo_builder','demo_reader']
names=['示例创作者','示例开发者','示例读者']
users=[{'rest_id':str(i+1),'core':{'screen_name':handle,'name':names[i],'created_at':(now-timedelta(days=[1340,365,40][i])).isoformat()},'relationship_counts':{'followers':counts[i],'following':[234,180,320][i]},'relationship_perspectives':{'following':i==0,'followed_by':i<2},'tweet_counts':{'tweets':[1578,256,35][i]},'is_blue_verified':True} for i,handle in enumerate(handles)]
svg=base64.b64encode((ROOT/'assets/icon.svg').read_bytes()).decode()
articles=''
texts=['关注一个账号之前，先看一眼公开资料。粉丝数、关注关系和账号年龄，直接显示在时间线中。','今天分享一个小工具的开发过程。鼠标停在任意标签上，就能查看同一张账号详情卡。','新的账号也可以有好的内容。标签描述数据，内容是否值得关注，由你判断。']
for i,handle in enumerate(handles):
    articles+=f'<article><div class="avatar a{i}">{names[i][2]}</div><div class="entry"><div data-testid="User-Name"><div class="name-group"><a href="/{handle}">{names[i]}</a><span class="verified">✓</span></div><a class="handle" href="/{handle}">@{handle}</a><a class="time" href="/{handle}/status/1">· {i+1}h</a></div><p>{texts[i]}</p><div class="actions">♡ {29-i*7}　　↻ {3+i}　　◷ {420+i*118}</div></div></article>'
html='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;color:#0f1419;background:#fff;font:16px/1.6 system-ui,sans-serif}a{color:inherit;text-decoration:none}.layout{display:grid;grid-template-columns:225px 650px 285px;gap:0;width:1160px;margin:auto}nav{padding:24px 20px;font-size:20px}nav div{margin:24px 0}nav .brand{font-size:36px;font-weight:700}main{border-left:1px solid #eff3f4;border-right:1px solid #eff3f4;min-height:800px}h1{margin:0;padding:18px 24px;font-size:22px;border-bottom:1px solid #eff3f4}.tabs{display:flex;justify-content:space-around;padding:16px;border-bottom:1px solid #eff3f4;font-weight:650}.tabs span:first-child{color:#0877b6}.composer{padding:24px;color:#536471;border-bottom:1px solid #eff3f4}article{display:flex;padding:22px 18px;gap:12px;border-bottom:1px solid #eff3f4}.entry{min-width:0;flex:1}.avatar{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;background:#5b59a8}.a1{background:#24826f}.a2{background:#967348}[data-testid="User-Name"]{display:flex;align-items:center;min-width:0;gap:4px;font-size:13px;font-weight:700}.name-group{display:flex;gap:4px;align-items:center}.handle,.time{color:#536471;font-weight:400;white-space:nowrap}.verified{background:#1d9bf0;color:#fff;border-radius:50%;font-size:10px;width:14px;height:14px;display:inline-grid;place-items:center}.entry p{margin:8px 0 20px}.actions{color:#536471;font-size:14px}aside{padding:24px}.info{background:#f7f9f9;border-radius:16px;padding:22px;font-size:14px}.info h2{font-size:19px;margin:0 0 12px}.info p{margin:8px 0}.demo{margin-top:24px;color:#536471;font-size:12px}
</style></head><body><div class="layout"><nav><div class="brand">𝕏</div><div>⌂　首页</div><div>⌕　探索</div><div>♧　通知</div><div>◎　个人资料</div><div>⋯　更多</div></nav><main><h1>首页</h1><div class="tabs"><span>为你推荐</span><span>正在关注</span></div><div class="composer">有什么新鲜事？</div>'''+articles+'''</main><aside><div class="info"><h2>X 粉丝数</h2><p>粉丝量级 · 关注关系</p><p>账号年龄 · 统一详情卡</p><p>可选本机粉丝趋势</p></div><p class="demo">演示数据 · 合成账号与历史<br>非 X 官方扩展</p></aside></div><script>fetch('/i/api/graphql/demo/HomeTimeline').then(r=>r.json());</script></body></html>'''
binaries=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/*app/Contents/MacOS/*'))
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='xfc-store-') as profile:
    context=p.chromium.launch_persistent_context(profile,headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE',str(binaries[-1])),ignore_default_args=['--disable-extensions'],args=[f'--disable-extensions-except={ROOT/"extension"}',f'--load-extension={ROOT/"extension"}'],viewport={'width':1280,'height':800})
    page=context.pages[0]
    # Normalize only the large store icon; small toolbar icons keep their visibility.
    page.set_content(f'<canvas width="128" height="128"></canvas><img id="source" src="data:image/svg+xml;base64,{svg}">')
    png=page.evaluate('''async()=>{const image=document.querySelector('img');await image.decode();const c=document.querySelector('canvas');c.getContext('2d').drawImage(image,13.639344,13.639344,100.721312,100.721312);return c.toDataURL('image/png').split(',')[1]}''')
    (ROOT/'extension/icons/icon-128.png').write_bytes(base64.b64decode(png))
    shutil.copyfile(ROOT/'extension/icons/icon-128.png',OUT/'icon-128.png')
    page.set_viewport_size({'width':440,'height':280})
    page.set_content(f'''<html lang="zh-CN"><meta charset="utf-8"><style>*{{box-sizing:border-box}}body{{margin:0;width:440px;height:280px;background:#f7f9f9;color:#101419;font-family:system-ui}}.box{{padding:32px 34px}}.top{{display:flex;align-items:center;gap:18px}}img{{width:64px;height:64px}}h1{{font-size:28px;margin:0}}p{{font-size:15px;margin:6px 0;color:#536471}}.row{{display:flex;gap:8px;margin-top:32px}}span{{font-size:14px;font-weight:700;border-radius:6px;padding:5px 9px;background:#e8f4fc;color:#0774af}}.relation{{background:#e1f5ed;color:#126443}}.age{{background:#edf0f2;color:#536471}}small{{display:block;color:#536471;margin-top:22px;font-size:12px}}</style><div class="box"><div class="top"><img src="data:image/svg+xml;base64,{svg}"><div><h1>X 粉丝数</h1><p>刷 X 时，直接看账号信息</p></div></div><div class="row"><span>粉丝 6,378</span><span class="relation">互相关注</span><span class="age">3年8个月</span></div><small>账号详情 · 可选本机趋势　／　非官方扩展</small></div></html>''')
    page.screenshot(path=str(OUT/'promo-440x280.png'))
    page.set_viewport_size({'width':1280,'height':800})
    def route(r):
        if r.request.url=='https://x.com/home':r.fulfill(content_type='text/html',body=html)
        elif r.request.url=='https://x.com/i/api/graphql/demo/HomeTimeline':r.fulfill(content_type='application/json',body=json.dumps({'data':{'users':users}}))
        else:r.abort()
    context.route('https://x.com/**',route)
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    days={}
    for offset,count in [(6,6210),(5,6245),(4,6290),(3,6308),(2,6330),(1,6355)]:
        date=now-timedelta(days=offset);snapshot={'at':ms(date),'count':count};days[day(date)]={'first':snapshot,'last':snapshot}
    worker.evaluate("state=>chrome.storage.local.set({'xfc-history-v1':state})",{'version':1,'users':{'1':{'userId':'1','lastSeen':ms(now),'days':days}},'settings':{'recording':True,'verification':True}})
    page.goto('https://x.com/home')
    badge=page.locator('.xfc-badge').first
    expect(badge).to_have_text('粉丝 6,378')
    page.screenshot(path=str(OUT/'screenshot-labels-1280x800.png'))
    badge.hover();card=page.get_by_role('dialog',name='账号详情')
    expect(card).to_be_visible();expect(card.locator('.xfc-bar')).to_have_count(7)
    page.screenshot(path=str(OUT/'screenshot-card-1280x800.png'))
    context.close()
print(OUT)
