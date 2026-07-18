// E2E: social client — claim a handle, friends card (code/requests/add),
// inbox challenge -> plays the exact set, direct-challenge buttons on results.
// /social is stubbed with a tiny in-memory state machine.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = '/home/user/Timeline';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
function makeWav(){
  const sr=8000,n=3200;const d=Buffer.alloc(n*2);
  for(let i=0;i<n;i++)d.writeInt16LE((Math.floor(i/40)%2)?4000:-4000,i*2);
  const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+d.length,4);h.write('WAVEfmt ',8);
  h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);
  h.writeUInt32LE(sr*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(d.length,40);
  return Buffer.concat([h,d]);
}
const WAV = makeWav();
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  if(p==='/clip.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Access-Control-Allow-Origin':'*'});return res.end(WAV);}
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

(async()=>{
  await new Promise(r=>server.listen(8108,r));
  const base='http://localhost:8108/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  let tid=1;
  await pg.route(/itunes\.apple\.com/, route=>{
    const u=new URL(route.request().url());const cb=u.searchParams.get('callback');const term=u.searchParams.get('term')||'x';
    route.fulfill({contentType:'text/javascript',body:`${cb}(${JSON.stringify({resultCount:1,results:[{trackId:++tid,trackName:term,artistName:term,collectionName:'T',releaseDate:'1990-01-01',previewUrl:'http://localhost:8108/clip.wav'}]})})`});
  });

  // tiny /social state machine
  const state = { me: null, friends: [], requests: [], outgoing: 0, inbox: [] };
  const actions = [];
  await pg.route(/lb\.test/, route=>{
    const req = route.request();
    const u = req.url();
    if(/\/social/.test(u)){
      if(req.method()==='POST'){
        const b = JSON.parse(req.postData());
        actions.push(b);
        if(b.action==='claim') state.me = { handle:b.handle, code:'YW-ABC234' };
        if(b.action==='add'){ state.outgoing = 1; }
        if(b.action==='accept'){ state.requests = []; state.friends = [{id:'f1', handle:'Jesse'}]; }
        if(b.action==='seen'){ state.inbox = state.inbox.filter(m=>!b.ids.includes(m.id)); }
        if(b.action==='challenge'){ /* recorded via actions */ }
      }
      route.fulfill({contentType:'application/json', body: JSON.stringify(state),
        headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}});
      return;
    }
    // daily/chal endpoints: minimal happy responses
    const body = /\/chal/.test(u)
      ? { set:'x', total:1, results:[{nick:'You',score:2,timeMs:9000,you:true}] }
      : { day:18, total:1, me:{nick:'You',score:2,timeMs:9000,rank:1}, top:[] };
    route.fulfill({contentType:'application/json', body: JSON.stringify(body),
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}});
  });

  await pg.goto(base,{waitUntil:'load'});
  await pg.waitForTimeout(800);
  // this context tests the social flows with Google OFF (clientId cleared)
  await pg.evaluate(()=>{ LB.url='https://lb.test'; GAUTH.clientId=''; renderSetup(); });
  await pg.waitForTimeout(500);

  // 1) no profile -> claim card
  let card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Claim a name/.test(card)) throw new Error('claim card missing: '+card.slice(0,120));
  if(/Played before|Google/.test(card)) throw new Error('Google UI must stay hidden while GAUTH.clientId is empty');
  await pg.$eval('#handleIn', e=>{ e.value='Sam K'; });
  await pg.click('#friendsCard button:has-text("Claim")');
  await pg.waitForTimeout(400);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/YW-ABC234/.test(card)) throw new Error('friend code not shown after claim: '+card.slice(0,160));
  if(actions[0].action!=='claim' || actions[0].handle!=='Sam K') throw new Error('claim POST wrong: '+JSON.stringify(actions[0]));
  const chip = await pg.$eval('.nickchip', e=>e.textContent);
  if(!/Sam K/.test(chip)) throw new Error('nick chip did not adopt the handle: '+chip);
  console.log('claim: card + code + chip sync OK');

  // 2) incoming friend request -> accept
  state.requests = [{id:'f1', handle:'Jesse'}];
  await pg.evaluate(()=>socialGet().then(st=>renderFriendsCard(st)));
  await pg.waitForTimeout(300);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Jesse wants to be friends/.test(card)) throw new Error('request row missing: '+card.slice(0,160));
  await pg.click('#friendsCard button[aria-label="Accept"]');
  await pg.waitForTimeout(400);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Jesse/.test(card) || /wants to be friends/.test(card)) throw new Error('accept did not settle: '+card.slice(0,160));
  if(!actions.some(a=>a.action==='accept' && a.user==='f1')) throw new Error('accept POST missing');
  console.log('friend request accept OK');

  // 3) add by code posts the code
  await pg.$eval('#codeIn', e=>{ e.value='yw-zz88kk'; });
  await pg.click('#friendsCard button:has-text("+ Add")');
  await pg.waitForTimeout(300);
  if(!actions.some(a=>a.action==='add' && a.code==='yw-zz88kk')) throw new Error('add POST missing');
  console.log('add-by-code OK');

  // 4) inbox challenge -> Play launches THAT set with the beat score
  state.inbox = [{id:7, from:'f1', handle:'Jesse', kind:'challenge', payload:{set:'10.20.30.40.50.60', score:4, timeMs:12000}, created:1}];
  await pg.evaluate(()=>socialGet().then(st=>renderFriendsCard(st)));
  await pg.waitForTimeout(300);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Jesse challenged you — beat 4\/5/.test(card)) throw new Error('inbox row missing: '+card.slice(0,200));
  await pg.click('#friendsCard button:has-text("▶ Play")');
  await pg.waitForSelector('.slot.active',{timeout:30000});
  const st = await pg.evaluate(()=>({mode:S.mode, beat:S.challenge && S.challenge.beat, idx:S.challenge && S.challenge.idx.join('.')}));
  if(st.mode!=='challenge' || st.beat!==4 || st.idx!=='10.20.30.40.50.60') throw new Error('inbox play state wrong: '+JSON.stringify(st));
  if(!actions.some(a=>a.action==='seen' && a.ids && a.ids.includes(7))) throw new Error('seen POST missing');
  console.log('inbox challenge plays the exact set (beat 4/5) + marked seen OK');

  // 5) finish the run; results offer direct-send buttons per friend
  for(let i=1;i<=5;i++){
    await pg.waitForSelector('.slot.active',{timeout:30000});
    await pg.click('.slot.active');
    await pg.waitForSelector('#overlay.show',{timeout:8000});
    if(i===5) break;
    await pg.click('#sheet .btn.primary');
    await pg.waitForFunction(()=>!document.getElementById('overlay').classList.contains('show'), null, {timeout:8000}).catch(()=>{});
    await pg.waitForTimeout(200);
  }
  await pg.waitForTimeout(500);
  const sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/straight to a friend/.test(sheet) || !/⚔️ Jesse/.test(sheet)) throw new Error('direct-send buttons missing: '+sheet.slice(0,240));
  await pg.click('#sheet button:has-text("⚔️ Jesse")');
  await pg.waitForTimeout(300);
  const sent = actions.find(a=>a.action==='challenge');
  if(!sent || sent.to!=='f1' || !/^\d+(\.\d+)+$/.test(sent.set) || sent.score==null) throw new Error('direct challenge POST wrong: '+JSON.stringify(sent));
  console.log('direct-send button posts the set to the friend OK ·', JSON.stringify({to:sent.to, score:sent.score}));

  await ctx.close();

  // 6) Google sign-in — fake GIS button + stubbed /auth restores the account
  const ctx2 = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg2 = await ctx2.newPage();
  pg2.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  const authPosts = [];
  const state2 = { me:null, friends:[], requests:[], outgoing:0, inbox:[] };
  await pg2.route(/itunes\.apple\.com/, route=>{
    const u=new URL(route.request().url());const cb=u.searchParams.get('callback');
    route.fulfill({contentType:'text/javascript',body:`${cb}({"resultCount":0,"results":[]})`});
  });
  await pg2.route(/lb\.test/, route=>{
    const req=route.request();
    if(/\/auth/.test(req.url()) && req.method()==='POST'){
      authPosts.push(JSON.parse(req.postData()));
      state2.me = { handle:'Tim', code:'YW-TTT222', linked:true };
    }
    route.fulfill({contentType:'application/json', body: JSON.stringify(state2),
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}});
  });
  await pg2.addInitScript(()=>{
    window.google = { accounts: { id: {
      initialize(o){ window.__gcb = o.callback; },
      renderButton(el){ const b=document.createElement('button'); b.id='fakeGsi';
        b.textContent='Sign in with Google'; b.onclick=()=>window.__gcb({credential:'FAKE.JWT.TOK'});
        el.appendChild(b); }
    }}};
  });
  await pg2.goto(base,{waitUntil:'load'});
  await pg2.waitForTimeout(700);
  await pg2.evaluate(()=>{ LB.url='https://lb.test'; GAUTH.clientId='test-client'; renderSetup(); });
  await pg2.waitForTimeout(400);
  let c2 = await pg2.$eval('#friendsCard', e=>e.innerText);
  if(!/Played before on another phone/.test(c2)) throw new Error('sign-in hint missing on claim card: '+c2.slice(0,160));
  const hasBtn = await pg2.$('#gsiBtn #fakeGsi');
  if(!hasBtn) throw new Error('Google button not mounted');
  await pg2.click('#fakeGsi');
  await pg2.waitForTimeout(400);
  if(authPosts.length!==1 || authPosts[0].credential!=='FAKE.JWT.TOK' || !/^[a-f0-9]{32}$/.test(authPosts[0].device))
    throw new Error('auth POST wrong: '+JSON.stringify(authPosts));
  c2 = await pg2.$eval('#friendsCard', e=>e.innerText);
  if(!/YW-TTT222/.test(c2) || !/Google-linked/.test(c2)) throw new Error('restored account not shown: '+c2.slice(0,200));
  const chip2 = await pg2.$eval('.nickchip', e=>e.textContent);
  if(!/Tim/.test(chip2)) throw new Error('chip did not adopt restored handle: '+chip2);
  console.log('Google sign-in: hidden-until-configured, button mounts, /auth restores account + linked badge OK');
  await ctx2.close();

  console.log('SOCIAL TEST PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
