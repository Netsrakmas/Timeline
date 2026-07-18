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
        if(b.action==='add'){   // instant friendship — no accept round-trip
          state.friends = [...state.friends, {id:'f9', handle:'Zoe', w:0, l:0, t:0}];
        }
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
  // the wrapper div hides the card from the .card + .card sibling rule —
  // it needs its own top margin to breathe under the challenge card
  const fcM = await pg.$eval('#friendsCard .card', e=>getComputedStyle(e).marginTop);
  if(fcM !== '16px') throw new Error('friends card missing top margin: '+fcM);
  // typeless inputs must pick up the dark theme (UA default is white)
  const inCss = await pg.$eval('#handleIn', e=>{ const s=getComputedStyle(e); return s.backgroundColor+'|'+s.borderRadius; });
  if(/rgb\(255, 255, 255\)/.test(inCss) || !/10px/.test(inCss)) throw new Error('handle input not dark-themed: '+inCss);
  await pg.$eval('#handleIn', e=>{ e.value='Sam K'; });
  await pg.click('#friendsCard button:has-text("Claim")');
  await pg.waitForTimeout(400);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/YW-ABC234/.test(card)) throw new Error('friend code not shown after claim: '+card.slice(0,160));
  const claimAct = actions.find(a=>a.action==='claim');
  if(!claimAct || claimAct.handle!=='Sam K') throw new Error('claim POST wrong: '+JSON.stringify(claimAct));
  const chip = await pg.$eval('.nickchip', e=>e.textContent);
  if(!/Sam K/.test(chip)) throw new Error('nick chip did not adopt the handle: '+chip);
  console.log('claim: card + code + chip sync OK');

  // 1b) the code button SHARES an invite link (app share, not just clipboard)
  await pg.evaluate(()=>{ navigator.share = t=>{ window.__shared=(t&&t.text)||String(t); return Promise.resolve(); }; });
  await pg.click('#friendsCard button[aria-label="Share your friend code"]');
  await pg.waitForTimeout(200);
  const codeShared = await pg.evaluate(()=>window.__shared);
  if(!codeShared || !/YW-ABC234/.test(codeShared) || !/#add=YW-ABC234/.test(codeShared))
    throw new Error('code share text wrong: '+codeShared);
  console.log('friend code: share sheet with invite link OK');

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

  // 3) add by code posts the code and lands as an INSTANT friend
  await pg.$eval('#codeIn', e=>{ e.value='yw-zz88kk'; });
  await pg.click('#friendsCard button:has-text("+ Add")');
  await pg.waitForTimeout(300);
  if(!actions.some(a=>a.action==='add' && a.code==='yw-zz88kk')) throw new Error('add POST missing');
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Zoe/.test(card)) throw new Error('instant friend not rendered: '+card.slice(0,200));
  console.log('add-by-code: instant friend OK');

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
  // NOT marked seen yet — the message is consumed on the results screen, so an
  // aborted start (resolution failure) keeps the challenge for a retry
  if(actions.some(a=>a.action==='seen' && a.ids && a.ids.includes(7))) throw new Error('challenge seen too early (before the run finished)');
  console.log('inbox challenge plays the exact set (beat 4/5), not consumed early OK');

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
  // 5a) this run came from Jesse's inbox challenge -> reaction row present
  if(!/react to Jesse/.test(sheet)) throw new Error('reaction row missing: '+sheet.slice(0,240));
  await pg.click('#reactRow button:has-text("🔥")');
  await pg.waitForTimeout(300);
  const rAct = actions.find(a=>a.action==='react');
  if(!rAct || rAct.to!=='f1' || rAct.emoji!=='🔥') throw new Error('react POST wrong: '+JSON.stringify(rAct));
  const disabled = await pg.$$eval('#reactRow button', bs=>bs.every(b=>b.disabled));
  if(!disabled) throw new Error('reaction buttons should lock after one send');
  console.log('reaction row: sends 🔥 to Jesse once OK');
  await pg.click('#sheet button:has-text("⚔️ Jesse")');
  await pg.waitForTimeout(300);
  const sent = actions.find(a=>a.action==='challenge');
  if(!sent || sent.to!=='f1' || !/^\d+(\.\d+)+$/.test(sent.set) || sent.score==null) throw new Error('direct challenge POST wrong: '+JSON.stringify(sent));
  console.log('direct-send button posts the set to the friend OK ·', JSON.stringify({to:sent.to, score:sent.score}));

  // 5c) finishing an inbox challenge reports the duel result (msg id 7) —
  // and a LOST duel gets no confetti
  const resAct = actions.find(a=>a.action==='result');
  if(!resAct || resAct.id!==7 || !Number.isFinite(resAct.score)) throw new Error('result POST wrong: '+JSON.stringify(resAct));
  if(!actions.some(a=>a.action==='seen' && a.ids && a.ids.includes(7))) throw new Error('challenge not consumed (seen) at run end');
  if(await pg.$('#confetti')) throw new Error('confetti on a lost duel');
  console.log('duel result + seen reported at run end (id 7), no confetti on a loss OK');

  // 5d) a WON challenge bursts confetti; reduced motion suppresses it
  await pg.evaluate(()=>{
    document.getElementById('overlay').classList.remove('show');
    S.mode='challenge'; S.current=null; S.lastReveal=null; S.reactTo=null;
    S.players=[{name:'You', hits:5, timeMs:1000, results:[1,1,1,1,1], timeline:[]}];
    S.challenge={idx:[11,12,13,14,15,16], beat:2, beatTime:null};
    overlayRunOver();
  });
  await pg.waitForTimeout(300);
  const bits = await pg.$$eval('#confetti i', els=>els.length).catch(()=>0);
  if(!bits) throw new Error('no confetti on a won challenge');
  await pg.emulateMedia({reducedMotion:'reduce'});
  await pg.evaluate(()=>{
    const c=document.getElementById('confetti'); if(c) c.remove();
    document.getElementById('overlay').classList.remove('show');
    S.challenge={idx:[21,22,23,24,25,26], beat:1, beatTime:null};
    overlayRunOver();
  });
  await pg.waitForTimeout(200);
  if(await pg.$('#confetti')) throw new Error('confetti despite prefers-reduced-motion');
  await pg.emulateMedia({reducedMotion:'no-preference'});
  console.log('confetti on a won duel, suppressed under reduced motion OK');

  // 5b) an incoming reaction renders in the friends card and dismisses
  state.inbox = [{id:9, from:'f1', handle:'Jesse', kind:'react', payload:{emoji:'😂', score:2}, created:2}];
  await pg.click('#sheet button:has-text("Done")');
  await pg.waitForTimeout(600);
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(!/Jesse reacted 😂 to your challenge/.test(card)) throw new Error('reaction inbox row missing: '+card.slice(0,220));
  await pg.click('#friendsCard button[aria-label="Dismiss"]');
  await pg.waitForTimeout(300);
  if(!actions.some(a=>a.action==='seen' && a.ids && a.ids.includes(9))) throw new Error('dismiss seen POST missing');
  card = await pg.$eval('#friendsCard', e=>e.innerText);
  if(/Jesse reacted/.test(card)) throw new Error('dismissed reaction still shown');
  console.log('incoming reaction row + dismiss OK');

  // 5e) friends card renders the duel leaderboard + a challenger result row
  await pg.evaluate(()=>renderFriendsCard({
    me:{handle:'Sam', code:'YW-XXXXXX'},
    friends:[{id:'f2', handle:'Kim', w:0, l:0, t:0}, {id:'f1', handle:'Jesse', w:3, l:1, t:1}],
    requests:[], outgoing:0,
    inbox:[{id:11, from:'f1', handle:'Jesse', kind:'result', payload:{score:5, timeMs:60000, w:'them'}, created:3},
           {id:12, from:'f2', handle:'Kim', kind:'friend', payload:{}, created:4}]
  }));
  await pg.waitForTimeout(200);
  card = await pg.$eval('#friendsCard', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Kim used your code — you're friends now/.test(card)) throw new Error('friend note row missing: '+card.slice(0,300));
  if(!/👑 you 3–1 · 1 tie/.test(card)) throw new Error('duel record missing: '+card.slice(0,240));
  if(!(/Jesse[\s\S]*👑[\s\S]*Kim/.test(await pg.$eval('#friendsCard', e=>e.innerText)))) throw new Error('duel sort wrong (Jesse should rank above Kim)');
  if(!/Jesse played your challenge — 5\/5 · they beat you/.test(card)) throw new Error('challenger result row missing: '+card.slice(0,300));
  if(!await pg.$('#friendsCard button[aria-label="Challenge Jesse"]')) throw new Error('per-friend challenge button missing');
  console.log('friends card: duel leaderboard sorted + result row + ⚔️ buttons OK');

  // 5f) tapping a friend's ⚔️ starts a fresh run and auto-sends the gauntlet
  const nActs = actions.length;
  await pg.click('#friendsCard button[aria-label="Challenge Jesse"]');
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
  const autoChal = actions.slice(nActs).find(a=>a.action==='challenge');
  if(!autoChal || autoChal.to!=='f1' || !/^\d+(\.\d+)+$/.test(autoChal.set) || autoChal.score==null)
    throw new Error('friend challenge did not auto-send: '+JSON.stringify(autoChal));
  const sheet2 = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Sent to Jesse — you set \d\/5/.test(sheet2)) throw new Error('sent line missing: '+sheet2.slice(0,260));
  if(/⚔️ Jesse/.test(sheet2)) throw new Error('target friend should not reappear in the direct-send row');
  if(!/Challenge someone else on these songs/.test(sheet2)) throw new Error('share button should read "someone else" after auto-send: '+sheet2.slice(0,260));
  console.log('friend ⚔️ button: fresh run + auto-sent gauntlet + someone-else label OK');

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
  // our themed pill carries the look; Google's real button overlays it invisibly
  if(!await pg2.$('#gsiBtn .gbtn')) throw new Error('themed google pill missing');
  const gOp = await pg2.$eval('#gsiBtn .greal', e=>getComputedStyle(e).opacity);
  if(parseFloat(gOp) > 0.05) throw new Error('real google button should be invisible, opacity='+gOp);
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

  // 7) opening an invite link (#add=CODE) arms the code; claiming a name
  // then fires the friend request automatically
  const ctx3 = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg3 = await ctx3.newPage();
  pg3.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  const actions3 = [];
  const state3 = { me:null, friends:[], requests:[], outgoing:0, inbox:[] };
  await pg3.route(/itunes\.apple\.com/, route=>{
    const u=new URL(route.request().url());const cb=u.searchParams.get('callback');
    route.fulfill({contentType:'text/javascript',body:`${cb}({"resultCount":0,"results":[]})`});
  });
  await pg3.route(/lb\.test/, route=>{
    const req=route.request();
    if(/\/social/.test(req.url()) && req.method()==='POST'){
      const b=JSON.parse(req.postData()); actions3.push(b);
      if(b.action==='claim') state3.me = { handle:b.handle, code:'YW-NEW111' };
      if(b.action==='add') state3.friends = [{id:'x1', handle:'Inviter', w:0, l:0, t:0}];   // instant friendship
    }
    route.fulfill({contentType:'application/json', body: JSON.stringify(state3),
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}});
  });
  await pg3.goto(base+'#add=YW-ZZ77KK',{waitUntil:'load'});
  await pg3.waitForTimeout(700);
  const armed = await pg3.evaluate(()=>({ pend: store.get('tl_pendingAdd'), hash: location.hash }));
  if(armed.pend!=='YW-ZZ77KK') throw new Error('invite code not armed: '+JSON.stringify(armed));
  if(/add=/.test(armed.hash)) throw new Error('invite hash not cleaned: '+armed.hash);
  await pg3.evaluate(()=>{ LB.url='https://lb.test'; GAUTH.clientId=''; renderSetup(); });
  await pg3.waitForTimeout(500);
  if(actions3.some(a=>a.action==='add')) throw new Error('add fired before a profile exists');
  await pg3.$eval('#handleIn', e=>{ e.value='Frodo'; });
  await pg3.click('#friendsCard button:has-text("Claim")');
  await pg3.waitForTimeout(500);
  const addAct = actions3.find(a=>a.action==='add');
  if(!addAct || addAct.code!=='YW-ZZ77KK') throw new Error('pending add did not fire after claim: '+JSON.stringify(actions3));
  const pendAfter = await pg3.evaluate(()=>store.get('tl_pendingAdd'));
  if(pendAfter) throw new Error('pending code not cleared after add');
  console.log('invite link: arms code, hash cleaned, auto-adds after claim OK');
  await ctx3.close();

  console.log('SOCIAL TEST PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
