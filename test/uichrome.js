// E2E: UI chrome — SVG line-icon set in the tab bar + mode cards (emoji stay
// for content, icons own the structure), and the synthesized SFX toggle.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = '/home/user/Timeline';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const f = path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

(async()=>{
  await new Promise(r=>server.listen(8087,r));
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({viewport:{width:540,height:1200},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  const posts = [];
  await pg.route(/lb\.test/, route=>{
    const req = route.request();
    if(req.method()==='POST'){ try{ posts.push(JSON.parse(req.postData())); }catch(e){} }
    route.fulfill({contentType:'application/json',
      body: JSON.stringify({me:null,friends:[],requests:[],outgoing:0,inbox:[]}),
      headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}});
  });
  await pg.goto('http://localhost:8087/',{waitUntil:'load'});
  await pg.waitForTimeout(600);
  await pg.evaluate(()=>{ LB.url='https://lb.test'; goTab('play'); });
  await pg.waitForTimeout(400);

  // 1) tab bar: four line icons, no emoji glyphs
  const ticos = await pg.$$eval('.tabbar .tico svg.ico', els=>els.length);
  if(ticos !== 4) throw new Error('expected 4 svg tab icons, got '+ticos);
  const barTxt = await pg.$eval('.tabbar', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Play/.test(barTxt) || !/Friends/.test(barTxt) || !/Ranks/.test(barTxt) || !/Profile/.test(barTxt))
    throw new Error('tab labels wrong: '+barTxt);
  if(/[🎵👥🏆👤]/u.test(barTxt)) throw new Error('emoji still in the tab bar: '+barTxt);
  console.log('tab bar: 4 svg icons, emoji gone OK');

  // 2) mode cards: five line icons in their tinted chips, emoji gone
  const micos = await pg.$$eval('.modelist .modeicon svg.ico', els=>els.length);
  if(micos !== 5) throw new Error('expected 5 svg mode icons, got '+micos);
  const modeTxt = await pg.$eval('.modelist', e=>e.innerText);
  if(/[📅⚡🎯🎉]/u.test(modeTxt)) throw new Error('emoji still on the mode cards: '+modeTxt.slice(0,200));
  const colored = await pg.$$eval('.modelist .modeicon', els=>els.filter(e=>/color/.test(e.getAttribute('style')||'')).length);
  if(colored !== 5) throw new Error('mode icons missing their accent colors: '+colored);
  console.log('mode cards: 5 colored svg icons OK');

  // 3) every named icon renders paths (no typo'd empty svg anywhere)
  const empty = await pg.evaluate(()=>Object.keys(ICO).filter(k=>!/["/]/.test(ICO[k]) || ico(k).indexOf('></svg>')>-1 && !ICO[k].length));
  if(empty.length) throw new Error('empty icon defs: '+empty.join(','));
  console.log('icon defs all non-empty OK');

  // 4) SFX: on by default, all cues run without throwing, toggle persists
  const sfxRes = await pg.evaluate(()=>{ try{ sfx('good'); sfx('bad'); sfx('win'); sfx('end'); sfx('lose'); sfx('ach'); return 'ok'; }catch(e){ return e.message; } });
  if(sfxRes !== 'ok') throw new Error('sfx threw: '+sfxRes);
  await pg.evaluate(()=>goTab('profile'));
  await pg.waitForTimeout(300);
  let prof = await pg.$eval('#app', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Sound effects/.test(prof)) throw new Error('sfx toggle card missing on Profile');
  if(!/little dings/.test(prof)) throw new Error('sfx should default ON: '+prof.slice(0,300));
  const offBtn = await pg.$$('#app .card .btn');
  await pg.evaluate(()=>toggleSfx());
  await pg.waitForTimeout(300);
  const flag = await pg.evaluate(()=>localStorage.getItem('tl_sfx'));
  if(flag !== '0') throw new Error('toggle off did not persist: '+flag);
  prof = await pg.$eval('#app', e=>e.innerText.replace(/\s+/g,' '));
  if(!/placements are silent/.test(prof)) throw new Error('off state copy missing');
  const silent = await pg.evaluate(()=>{ let made=false; const AC=window.AudioContext;
    window.AudioContext=function(){ made=true; return new AC(); }; sfx('good'); window.AudioContext=AC; return made; });
  if(silent) throw new Error('sfx still fires while disabled');
  await pg.evaluate(()=>toggleSfx());
  if(await pg.evaluate(()=>localStorage.getItem('tl_sfx')) !== '1') throw new Error('toggle back on did not persist');
  console.log('sfx: default on, cues run, toggle persists + silences OK');

  // 5) the chrome sweep: friends eyebrow + settings cards use inline icons,
  // share/link/swords emoji are gone from buttons (emoji stay in content rows)
  await pg.evaluate(()=>goTab('friends'));
  await pg.waitForTimeout(300);
  const fCard = await pg.$eval('#friendsCard', e=>({ svg: !!e.querySelector('.eyebrow svg.ico'), txt: e.innerText }));
  if(!fCard.svg) throw new Error('friends eyebrow missing its svg icon');
  if(/[👥📤🔗]/u.test(fCard.txt)) throw new Error('chrome emoji still on the friends card: '+fCard.txt.slice(0,200));
  await pg.evaluate(()=>goTab('profile'));
  await pg.waitForTimeout(300);
  const pIcons = await pg.$$eval('#app .card svg.ico.ii', els=>els.length);
  if(pIcons < 2) throw new Error('profile settings cards missing inline icons: '+pIcons);
  const pTxt = await pg.$eval('#app', e=>e.innerText);
  if(/🔔 Notifications|🔊 Sound/u.test(pTxt)) throw new Error('settings emoji not replaced');
  console.log('chrome sweep: friends + profile inline icons, emoji gone OK');

  // 5b) survival friends board: standard-deck bests sync out and render ranked
  await pg.evaluate(()=>{
    localStorage.setItem('tl_user', JSON.stringify({id:'u1', handle:'Sam', code:'YW-XXXXXX'}));
    localStorage.setItem('tl_lb_nick','Sam');
    // survival end on a STANDARD deck records the syncable best…
    S.mode='survival'; S.score=17; S.bestStreak=6; S.lives=0;
    S.selectedIds=[DECKS[0].id]; S.players=[{name:'You', timeline:[]}];
    overlayGameOver(false, S.players[0]);
    closeOverlay();
    // …but a CUSTOM-deck run must not touch it (20, not 99: crossing the
    // "Survivor" threshold here would leave an achievement popup mid-flight
    // that races the popup assertions of the next section)
    S.score=20; S.selectedIds=['uCUSTOM1']; overlayGameOver(false, S.players[0]); closeOverlay();
  });
  await pg.waitForTimeout(400);
  const bsync = await pg.evaluate(()=>JSON.parse(localStorage.getItem('tl_bsync')||'{}'));
  if((bsync.s|0) !== 17) throw new Error('standard survival best not recorded (or custom run leaked in): '+JSON.stringify(bsync));
  const withBest = posts.filter(p=>p.sbest===17);
  if(!withBest.length) throw new Error('sbest never sent to the server: '+JSON.stringify(posts.slice(-3)));
  await pg.evaluate(()=>goTab('ranks'));
  await pg.waitForTimeout(600);   // let afterLobby's socialGet land before stubbing state
  await pg.evaluate(()=>{
    _social = { me:{handle:'Sam', code:'YW-XXXXXX'},
      friends:[{id:'f1', handle:'Jesse', sbest:23, tbest:4, w:0,l:0,t:0}, {id:'f2', handle:'Kim', sbest:9, w:0,l:0,t:0}, {id:'f3', handle:'Noah', sbest:0, w:0,l:0,t:0}],
      requests:[], outgoing:0, inbox:[] };
    document.getElementById('ranksSurvival').innerHTML = ranksSurvivalRows();
  });
  const surv = await pg.$eval('#ranksSurvival', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Jesse.*23 placed.*\(you\).*17 placed.*Kim.*9 placed/.test(surv)) throw new Error('survival board wrong order/content: '+surv);
  if(/Noah/.test(surv)) throw new Error('zero-best friend should not be listed: '+surv);
  const dtlOpen = await pg.evaluate(()=>{ friendDetail('f1'); return document.getElementById('sheet').innerText.replace(/\s+/g,' '); });
  if(!/survival best 23/.test(dtlOpen) || !/turbo best 4\/5/.test(dtlOpen)) throw new Error('friend detail missing bests: '+dtlOpen.slice(0,240));
  await pg.evaluate(()=>closeOverlay());
  console.log('survival friends board: record + sync + ranked render + detail line OK');

  // 5c) achievement popup: silent baseline, pops on a fresh unlock, no re-pop
  await pg.evaluate(()=>{
    // flush pops left in flight by earlier sections (tab renders + game overs)
    _achT.splice(0).forEach(clearTimeout);
    const el = document.getElementById('achpop');
    if(el){ clearTimeout(el._t); el.classList.remove('show'); }
    localStorage.removeItem('tl_achseen');
    checkAchievements();   // first ever check → baseline, NO popup
  });
  await pg.waitForTimeout(1000);
  if(await pg.$('#achpop.show')) throw new Error('baseline check must not pop old achievements');
  if(!await pg.evaluate(()=>!!localStorage.getItem('tl_achseen'))) throw new Error('baseline not stored');
  await pg.evaluate(()=>{
    const life = JSON.parse(localStorage.getItem('tl_life')||'{}');
    life.games = 10; localStorage.setItem('tl_life', JSON.stringify(life));   // crosses "Getting Started"
    checkAchievements();
  });
  await pg.waitForTimeout(1100);
  const pop = await pg.$('#achpop.show');
  if(!pop) throw new Error('fresh unlock did not pop');
  const popTxt = await pg.$eval('#achpop', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Achievement unlocked!/i.test(popTxt) || !/Getting Started/.test(popTxt)) throw new Error('popup content wrong: '+popTxt);
  await pg.evaluate(()=>{ document.getElementById('achpop').classList.remove('show'); checkAchievements(); });
  await pg.waitForTimeout(1100);
  if(await pg.$('#achpop.show')) throw new Error('already-seen achievement popped again');
  console.log('achievement popup: silent baseline + fresh unlock + no re-pop OK');

  // 5d) anti-repeat memory: recently-heard songs sort behind fresh ones
  const rep = await pg.evaluate(()=>{
    localStorage.removeItem('tl_played');
    notePlayed({ name:'Song B', artist:'X' });
    notePlayed({ name:'Song D', artist:'X' });
    const order = freshFirst([
      { title:'Song A', artist:'X' }, { title:'Song B', artist:'X' },
      { title:'Song C', artist:'X' }, { title:'Song D', artist:'X' },
    ]).map(s=>s.title).join('');
    // LRU dedupe + cap
    notePlayed({ name:'Song B', artist:'X' });
    const lru = JSON.parse(localStorage.getItem('tl_played'));
    return { order, lru };
  });
  if(rep.order !== 'Song ASong CSong BSong D') throw new Error('freshFirst order wrong: '+rep.order);
  if(rep.lru.length !== 2 || rep.lru[1] !== 'song b|x') throw new Error('LRU dedupe wrong: '+JSON.stringify(rep.lru));
  console.log('anti-repeat memory: fresh-first partition + LRU dedupe OK');

  // 6) ducking: a cue dips the playing music, then volume fully recovers
  const wav = (()=>{ // 200ms of silence
    const sr=8000,n=1600,d=Buffer.alloc(n*2),h=Buffer.alloc(44);
    h.write('RIFF',0);h.writeUInt32LE(36+d.length,4);h.write('WAVEfmt ',8);
    h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);
    h.writeUInt32LE(sr*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(d.length,40);
    return Buffer.concat([h,d]).toString('base64');
  })();
  const dk = await pg.evaluate(async(b64)=>{
    const a = document.getElementById('aud');
    a.src = 'data:audio/wav;base64,'+b64; a.loop = true;
    await a.play();
    sfx('good');
    const dipped = a.volume;
    await new Promise(r=>setTimeout(r, 600));
    return { dipped, restored: a.volume, paused: a.paused };
  }, wav);
  if(dk.paused) throw new Error('test audio did not play — ducking not exercised');
  if(dk.dipped >= 0.9) throw new Error('music not ducked during the cue: volume '+dk.dipped);
  if(dk.restored !== 1) throw new Error('music volume did not recover after the cue: '+dk.restored);
  console.log('sfx ducking: dips to '+dk.dipped+' and recovers to 1 OK');

  await browser.close(); server.close();
  console.log('UI CHROME TEST PASS ✓');
})().catch(e=>{ console.error('UI CHROME TEST FAIL ✗', e); process.exit(1); });
