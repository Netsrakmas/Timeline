const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright-core');
const ROOT='/home/user/Timeline',CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
 const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(f).pipe(res);});
(async()=>{
 await new Promise(r=>srv.listen(8099,r));
 const b=await chromium.launch({executablePath:CHROME});
 const ctx=await b.newContext({viewport:{width:440,height:1200},hasTouch:true,serviceWorkers:'block',deviceScaleFactor:2});
 const pg=await ctx.newPage(); pg.on('pageerror',e=>console.log('PAGEERR:',e.message));
 // stub push APIs (headless Chromium can't do real web push)
 await pg.addInitScript(()=>{
   const fakeSub={ endpoint:'https://push.example/abc', toJSON(){ return { endpoint:this.endpoint, keys:{ p256dh:'BFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeKeyFakeK', auth:'AuthSecretXXXXXXXXXXXX' } }; }, async unsubscribe(){ return true; } };
   let cur=null;
   const reg={ pushManager:{ async getSubscription(){ return cur; }, async subscribe(){ cur=fakeSub; return fakeSub; } } };
   const swFake={ register:async()=>reg, ready:Promise.resolve(reg), addEventListener(){}, };
   try{ Object.defineProperty(navigator,'serviceWorker',{ configurable:true, get:()=>swFake }); }catch(e){}
   window.PushManager=function(){};
   const N=function(){}; N.permission='default'; N.requestPermission=async()=>{ N.permission='granted'; return 'granted'; };
   try{ Object.defineProperty(window,'Notification',{ configurable:true, get:()=>N }); }catch(e){}
   try{ localStorage.setItem('tl_nick','Sam'); localStorage.setItem('tl_user', JSON.stringify({code:'YW-ME0001'})); }catch(e){}
 });
 let pushSub=null;
 await pg.route(/lb\.test/, route=>{ const req=route.request();
   if(/\/social/.test(req.url())){ let bd={}; try{bd=JSON.parse(req.postData());}catch(e){}
     if(bd.action==='push-sub'){ pushSub=bd.sub; return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({ok:true})}); }
     return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({me:{handle:'Sam',code:'YW-ME0001'},friends:[],requests:[],outgoing:0,inbox:[]})}); }
   return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({day:16,total:1,me:null,top:[]})});
 });
 await pg.goto('http://localhost:8099/',{waitUntil:'load'}); await pg.waitForTimeout(400);
 await pg.evaluate(()=>{ LB.url='https://lb.test'; });
 await pg.evaluate(()=>goTab('profile')); await pg.waitForTimeout(400);
 // 1) card renders with "Turn on"
 const card = await pg.$eval('#app', e=>e.innerText);
 if(!/Notifications/.test(card) || !/Turn on/.test(card)) throw new Error('notifications card missing: '+card.slice(0,300));
 console.log('profile notifications card: present + Turn on OK');
 // 2) enable flow: click Turn on → subscribe → push-sub POST → tl_push set → flips to Turn off
 await pg.click('button:has-text("Turn on")'); await pg.waitForTimeout(500);
 if(!pushSub || !/push.example/.test(pushSub.endpoint)) throw new Error('push-sub not posted: '+JSON.stringify(pushSub));
 if((await pg.evaluate(()=>store.get('tl_push')))!=='1') throw new Error('tl_push not set');
 if((await pg.evaluate(()=>pushEnabled()))!==true) throw new Error('pushEnabled() false after enable');
 await pg.waitForTimeout(200);
 if(!/Turn off/.test(await pg.$eval('#app',e=>e.innerText))) throw new Error('toggle did not flip to Turn off');
 console.log('enable push: subscribe + push-sub POST + toggle flip OK ·', pushSub.endpoint);
 // 3) deep link: a FRESH load of #tab=friends starts on the Friends tab
 const pg2=await ctx.newPage();
 await pg2.route(/lb\.test/, r=>r.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({me:null,friends:[],requests:[],outgoing:0,inbox:[]})}));
 await pg2.goto('http://localhost:8099/#tab=friends',{waitUntil:'load'}); await pg2.waitForTimeout(500);
 if((await pg2.evaluate(()=>_tab))!=='friends') throw new Error('deep-link tab not honored: '+(await pg2.evaluate(()=>_tab)));
 if(/tab=/.test(await pg2.evaluate(()=>location.hash))) throw new Error('deep-link hash not cleaned');
 console.log('notification deep-link #tab=friends → Friends tab OK');
 console.log('PUSH CLIENT TEST PASS ✓');
 await b.close(); srv.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
