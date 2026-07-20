// Unit-test sw.js push + notificationclick handlers with a mock ServiceWorkerGlobalScope
const fs = require('fs');
const code = fs.readFileSync('/home/user/Timeline/sw.js','utf8');
const handlers = {};
let shown = null, focused = false, posted = null, opened = null;
const self = {
  addEventListener:(t,fn)=>{ handlers[t]=fn; },
  skipWaiting(){}, clients:{ claim(){}, async matchAll(){ return [{ focus(){ focused=true; return true; }, postMessage(m){ posted=m; } }]; }, async openWindow(u){ opened=u; } },
  registration:{ showNotification:(title,opts)=>{ shown={title,opts}; } },
  location:{ href:'https://x/sw.js' },
};
const caches = { open:async()=>({addAll:async()=>{}}), keys:async()=>[], match:async()=>null, delete:async()=>{} };
const fetchFn = async()=>({});
// eval in a scope with the mocked globals
new Function('self','caches','fetch', code)(self, caches, fetchFn);

(async()=>{
  // push event
  await handlers['push']({ data:{ json:()=>({ title:'You\'ve been challenged ⚔️', body:'Jesse challenged you', tab:'friends' }) }, waitUntil:p=>p });
  if(!shown || !/challenged/.test(shown.title) || shown.opts.data.tab!=='friends') throw new Error('push handler wrong: '+JSON.stringify(shown));
  console.log('push → showNotification:', JSON.stringify({title:shown.title, tab:shown.opts.data.tab}));
  // push with no data → safe defaults
  shown=null; await handlers['push']({ waitUntil:p=>p });
  if(!shown || shown.title!=='Yearworm') throw new Error('empty push default wrong');
  console.log('empty push → default title OK');
  // notificationclick → focuses an existing window + posts the tab
  await handlers['notificationclick']({ notification:{ close(){}, data:{ tab:'friends' } }, waitUntil:p=>p });
  if(!focused || !posted || posted.yearwormTab!=='friends') throw new Error('click routing wrong: '+JSON.stringify({focused,posted}));
  console.log('notificationclick → focus + postMessage tab:', posted.yearwormTab);
  console.log('SW PUSH HANDLERS OK ✓');
})().catch(e=>{ console.error('FAIL', e.message); process.exit(1); });
