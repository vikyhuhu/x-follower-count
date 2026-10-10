const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function boot(chrome, postMessage = () => {}) {
  const ctx=vm.createContext({chrome,AbortController,window:{postMessage},location:{origin:'https://x.com'}});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/runtime.js'),'utf8'),ctx);
  return ctx.__xfcRuntime;
}
test('invalidated runtime, missing sendMessage and bridge failure do not escape; cleanup once',async()=>{
  for(const chrome of [undefined,{}, {runtime:{}}, {runtime:{id:'test',sendMessage(){throw new Error('Extension context invalidated.');}}}, {runtime:{id:'test',sendMessage(){return Promise.reject(new Error('Extension context invalidated.'));}}}]) {
    const runtime=boot(chrome);let cleanups=0;runtime.cleanup(()=>cleanups++);
    assert.equal((await runtime.send('observe')).ok,false);
    assert.equal(runtime.active(),false);runtime.post({});
    assert.equal(runtime.signal.aborted,true);assert.equal(cleanups,1);
  }
  const runtime=boot({runtime:{id:'test',sendMessage:async()=>({ok:true})}},()=>{throw new Error('Extension context invalidated.');});
  assert.doesNotThrow(()=>runtime.post({}));assert.equal(runtime.active(),false);
});
test('runtime removal while an old page is alive stops later messages and aborts listeners',async()=>{
  let calls=0;const chrome={runtime:{id:'test',sendMessage:async()=>{calls++;return{ok:true};}}};
  const runtime=boot(chrome);assert.equal((await runtime.send('get')).ok,true);
  chrome.runtime=undefined;
  assert.equal((await runtime.send('observe')).ok,false);assert.equal(runtime.signal.aborted,true);
  assert.equal(calls,1);
});
test('temporary worker failure keeps the page usable; successful messages still work',async()=>{
  let fails=true;const runtime=boot({runtime:{id:'test',sendMessage:async()=>{if(fails)throw new Error('Receiving end does not exist');return{ok:true};}}});
  assert.equal((await runtime.send('get')).ok,false);assert.equal(runtime.active(),true);
  fails=false;assert.equal((await runtime.send('get')).ok,true);
});
