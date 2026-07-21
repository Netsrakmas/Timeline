// Unit-test sw.js push + notificationclick handlers with a mock ServiceWorkerGlobalScope
const fs = require('fs');
const code = fs.readFileSync('/home/user/Timeline/sw.js','utf8');
const handlers = {};
let shown = null, focused = false, posted = null, opened = null;
let resubscribed=null, rotated=null;
const self = {
  addEventListener:(t,fn)=>{ handlers[t]=fn; },
  skipWaiting(){}, clients:{ claim(){}, async matchAll(){ return [{ focus(){ focused=true; return true; }, postMessage(m){ posted=m; } }]; }, async openWindow(u){ opened=u; } },
  registration:{ showNotification:(title,opts)=>{ shown={title,opts}; },
    pushManager:{ async subscribe(opts){ resubscribed=opts; return { endpoint:'https://svc/new', toJSON(){ return { endpoint:'https://svc/new', keys:{p256dh:'PK',auth:'AU'} }; } }; } } },
  location:{ href:'https://x/sw.js' },
};
const caches = { open:async()=>({addAll:async()=>{}}), keys:async()=>[], match:async()=>null, delete:async()=>{} };
const fetchFn = async(url,opts)=>{ if(/push-rotate/.test(String(url))) rotated={url:String(url), body:JSON.parse(opts.body)}; return {}; };
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
  // pushsubscriptionchange → re-subscribe with the old options + tell the server
  await handlers['pushsubscriptionchange']({ oldSubscription:{ endpoint:'https://svc/old', options:{ userVisibleOnly:true, applicationServerKey:'K' } }, waitUntil:p=>p });
  await new Promise(r=>setTimeout(r,20));
  if(!resubscribed || resubscribed.applicationServerKey!=='K') throw new Error('did not re-subscribe with old options');
  if(!rotated || rotated.body.old!=='https://svc/old' || rotated.body.sub.endpoint!=='https://svc/new') throw new Error('rotate POST wrong: '+JSON.stringify(rotated));
  console.log('pushsubscriptionchange → resubscribe + /push-rotate OK');
  console.log('SW PUSH HANDLERS OK ✓');
})().catch(e=>{ console.error('FAIL', e.message); process.exit(1); });
