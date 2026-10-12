const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const data = require("../extension/data.js"), h = require("../extension/history.js");
const now = Date.parse("2026-10-10T06:00:00Z"), user = { userId: "123", screenName: "alice", name: "Alice", followersCount: 100, followingCount: 5, following: true, followedBy: true };
test("fresh install enables every option, while explicit saved choices survive normalization",()=>{
  const defaults={recording:true,verification:true,media:true,category:true,website:true};
  assert.deepEqual(h.empty().settings,defaults);
  assert.deepEqual(h.settings(),defaults);
  const disabled=Object.fromEntries(Object.keys(defaults).map(key=>[key,false]));
  assert.deepEqual(h.settings(disabled),disabled);
  const state=h.empty();state.settings=disabled;h.prune(state,now);
  assert.deepEqual(state.settings,disabled);
});
test("current and legacy profile metadata are independent, safely validated", () => {
  const [result] = data.extractUsers({rest_id:"123", core:{screen_name:"Alice",name:"Alice"},relationship_counts:{following:0,followers:5},tweet_counts:{tweets:10,media_tweets:3},verification:{verified:false},is_blue_verified:true,professional:{category:[{name:"Developer"}]},website:{url:"https://example.com"}});
  assert.equal(result.userId,"123"); assert.equal(result.followingCount,0); assert.equal(result.tweetCount,10); assert.equal(result.mediaCount,3); assert.equal(result.verification,"blue"); assert.equal(result.category,"Developer");
  assert.equal(data.normalizeUser({...user,website:"javascript:alert(1)"}).website,undefined);
  const [old] = data.extractUsers({id_str:"123",legacy:{screen_name:"Alice",friends_count:5,statuses_count:42,media_count:2}});
  assert.equal(old.followingCount,5); assert.equal(old.tweetCount,42);
});
test("Beijing midnight and daily snapshots preserve zero and missing days", () => {
  assert.equal(h.dayKey(Date.parse("2026-10-09T15:59:59Z")),"2026-10-09");
  assert.equal(h.dayKey(Date.parse("2026-10-09T16:00:00Z")),"2026-10-10");
  const state=h.empty();h.observe(state,[{...user,followersCount:0}],now-3*h.DAY);
  h.observe(state,[user],now);h.observe(state,[{...user,followersCount:105}],now+1000);
  const series=h.series(state.users["123"],now+1000).followers;
  assert.equal(series[0].count,null);assert.equal(series[3].count,0);assert.equal(series[4].count,null);assert.equal(series.at(-1).count,105);
  assert.deepEqual(Object.keys(state.users["123"]).sort(),["days","lastSeen","userId"]);
  assert.equal(state.users["123"].days[h.dayKey(now)].first.count,100);
});
test("rename uses numeric ID, metadata is not persisted and invalid/expired snapshots are removed",()=>{
  const state=h.empty();h.observe(state,[user],now-31*h.DAY);
  h.observe(state,[{...user,screenName:"renamed"}],now);
  assert.equal(Object.keys(state.users).length,1);assert.equal(Object.keys(state.users["123"].days).length,1);
  state.users["123"].profile={name:"Remove old profile"};state.users["123"].posts={1:{full_text:"Remove old post"}};
  state.users["123"].days.invalid={first:{at:NaN,count:0},last:{at:NaN,count:0}};
  state.users["123"].days.future={first:{at:now+1000,count:0},last:{at:now+1000,count:0}};
  h.prune(state,now);assert.equal(JSON.stringify(state).includes("Remove old"),false);
  assert.equal(Object.keys(state.users["123"].days).length,1);
  h.observe(state,[{...user,userId:"456",followersCount:undefined}],now);assert.equal(state.users["456"],undefined);
});
test("background defaults cannot be changed by pages; concurrent writes, restart and clearing work",async()=>{
  let saved={},handler;
  const chrome={runtime:{id:"test",onMessage:{addListener:fn=>handler=fn}},storage:{local:{get:async key=>({[key]:structuredClone(saved[key])}),set:async value=>{await new Promise(r=>setTimeout(r,3));Object.assign(saved,structuredClone(value));},getBytesInUse:async()=>JSON.stringify(saved).length}}};
  const boot=()=>{const ctx=vm.createContext({chrome,Date,URL,__xfcData:data,__xfcHistory:h,importScripts:()=>{}});vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../extension/background.js"),"utf8"),ctx);};
  const send=(type,extra={},ui=false)=>new Promise(resolve=>handler({channel:"xfc-local",type,...extra},{id:"test",url:ui?"chrome-extension://test/popup.html":"https://x.com/home",tab:{id:1}},resolve));
  boot();assert.equal((await send("status")).settings.recording,true);
  assert.equal((await send("settings",{settings:{recording:false}})).ok,false);
  await send("observe",{users:[user]});assert.equal(Object.keys(saved["xfc-history-v1"].users).length,1);
  await Promise.all([send("observe",{users:[user]}),send("observe",{users:[{...user,userId:"456",screenName:"bob"}]})]);
  assert.equal((await send("status")).users,2);boot();
  assert.equal(h.series((await send("get",{userId:"123"})).record).followers.at(-1).count,100);
  assert.equal((await send("clear-all")).ok,false);
  await send("settings",{settings:{recording:false,media:true}},true);
  assert.equal((await send("get",{userId:"123"})).record,null);
  boot();assert.equal((await send("status")).settings.recording,false);
  await send("observe",{users:[{...user,userId:"789"}]});assert.equal((await send("status")).users,2);
  await send("clear-all",{},true);assert.equal((await send("status")).users,0);assert.equal((await send("status")).settings.media,true);
});
test("legacy storage is minimized on first load, without automatically starting recording",async()=>{
  const legacy=h.empty();h.observe(legacy,[user]);legacy.settings={recording:false,verification:true,media:false,category:false,website:false};legacy.users["123"].profile={name:"old name"};legacy.users["123"].posts={1:{id:"1"}};
  let saved=legacy,handler;
  const chrome={runtime:{id:"test",onMessage:{addListener:fn=>handler=fn}},storage:{local:{get:async()=>({'xfc-history-v1':structuredClone(saved)}),set:async value=>saved=structuredClone(value['xfc-history-v1']),getBytesInUse:async()=>JSON.stringify(saved).length}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../extension/background.js"),"utf8"),{chrome,Date,__xfcData:data,__xfcHistory:h,importScripts:()=>{}});
  await new Promise(resolve=>handler({channel:"xfc-local",type:"status"},{id:"test",url:"chrome-extension://test/popup.html"},resolve));
  assert.deepEqual(saved.settings,legacy.settings);assert.equal(saved.users["123"].profile,undefined);assert.equal(saved.users["123"].posts,undefined);
});
test("retention evicts oldest accounts and stays below byte budget",()=>{
  const state=h.empty();
  for(let i=0;i<=h.MAX_USERS;i++) {
    const snapshot={at:now+i,count:100};
    state.users[String(i)]={userId:String(i),lastSeen:now+i,days:{[h.dayKey(now+i)]:{first:snapshot,last:snapshot}}};
  }
  h.prune(state,now+h.MAX_USERS);
  assert.equal(h.MAX_USERS,10000);
  assert.equal(Object.keys(state.users).length,h.MAX_USERS);assert.equal(state.users["0"],undefined);
  assert.ok(state.users["1"],"Accounts beyond the former 1000-user cap must retain history");
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength<h.MAX_BYTES);
  h.prune(state,now+32*h.DAY);assert.equal(Object.keys(state.users).length,0);
});
test("expanded history evicts oldest users by bytes before exceeding the storage budget",()=>{
  const state=h.empty();
  const days={};
  for(let offset=0;offset<30;offset++) {
    const snapshot={at:now-offset*h.DAY,count:99999999};
    days[h.dayKey(snapshot.at)]={first:snapshot,last:snapshot};
  }
  for(let i=0;i<3000;i++)state.users[String(i)]={userId:String(i),lastSeen:now-3000+i,days};
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength>h.MAX_BYTES);
  h.prune(state,now);
  assert.ok(Object.keys(state.users).length<3000);
  assert.equal(state.users["0"],undefined);
  assert.ok(state.users["2999"]);
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength<=h.MAX_BYTES);
});
test("expiry is written back while recording is disabled without restarting the worker",async()=>{
  let clock=now,saved=h.empty(),handler;
  h.observe(saved,[user],now);saved.settings.recording=false;
  const model={...h,prune:state=>h.prune(state,clock)};
  const chrome={runtime:{id:"test",onMessage:{addListener:fn=>handler=fn}},storage:{local:{get:async()=>({'xfc-history-v1':structuredClone(saved)}),set:async value=>saved=structuredClone(value['xfc-history-v1']),getBytesInUse:async()=>JSON.stringify(saved).length}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../extension/background.js"),"utf8"),{chrome,Date,__xfcData:data,__xfcHistory:model,importScripts:()=>{}});
  const status=()=>new Promise(resolve=>handler({channel:"xfc-local",type:"status"},{id:"test",url:"chrome-extension://test/popup.html"},resolve));
  assert.equal((await status()).users,1);
  clock+=32*h.DAY;assert.equal((await status()).users,0);assert.equal(Object.keys(saved.users).length,0);
});
test("older Chrome quota bounds history during load and later observations",async()=>{
  const at=Date.now(),quota=5*1024*1024,budget=quota-512*1024;
  let saved=h.empty(),handler;
  const days={};
  for(let offset=0;offset<30;offset++) {
    const snapshot={at:at-offset*h.DAY,count:99999999};
    days[h.dayKey(snapshot.at)]={first:snapshot,last:snapshot};
  }
  for(let i=0;i<2000;i++)saved.users[String(i)]={userId:String(i),lastSeen:at-2000+i,days};
  const size=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  assert.ok(size(saved)>quota);
  const chrome={runtime:{id:"test",onMessage:{addListener:fn=>handler=fn}},storage:{local:{QUOTA_BYTES:quota,get:async()=>({'xfc-history-v1':structuredClone(saved)}),set:async value=>{assert.ok(size(value)<=quota,"Writes must fit the actual browser quota");saved=structuredClone(value['xfc-history-v1']);},getBytesInUse:async()=>size(saved)}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../extension/background.js"),"utf8"),{chrome,Date,__xfcData:data,__xfcHistory:h,importScripts:()=>{}});
  const send=(type,extra={})=>new Promise(resolve=>handler({channel:"xfc-local",type,...extra},{id:"test",url:"https://x.com/home",tab:{id:1}},resolve));
  assert.equal((await send("status")).ok,true);
  assert.ok(size(saved)<=budget);
  assert.equal((await send("observe",{users:[{...user,userId:"9000"}]})).ok,true);
  assert.ok(size(saved)<=budget);
  assert.equal(saved.users["9000"].days[h.dayKey(Date.now())].last.count,100);
});
