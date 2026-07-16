// E2E: turbo (classic difficulty, solo + 2-player), daily (determinism, lock,
// share) and the challenge-link roundtrip.
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

let tid=1;
async function newPage(browser, url){
  const ctx = await browser.newContext({viewport:{width:540,height:1200},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await pg.addInitScript(()=>{ navigator.share = t => { window.__shared = (t&&t.text)||String(t); return Promise.resolve(); }; });
  await pg.route(/itunes\.apple\.com/, route=>{
    const u=new URL(route.request().url());const cb=u.searchParams.get('callback');const term=u.searchParams.get('term')||'x';
    route.fulfill({contentType:'text/javascript',body:`${cb}(${JSON.stringify({resultCount:1,results:[{trackId:++tid,trackName:term,artistName:term,collectionName:'T',releaseDate:'1999-01-01',previewUrl:'http://localhost:8079/clip.wav'}]})})`});
  });
  await pg.goto(url,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  return {ctx,pg};
}
async function placeN(pg, n, collectTitles){
  const titles=[];
  for(let i=1;i<=n;i++){
    await pg.waitForSelector('.slot.active',{timeout:20000});
    await pg.click('.slot.active');
    await pg.waitForSelector('#overlay.show',{timeout:5000});
    if(collectTitles) titles.push(await pg.$eval('.reveal-ti', e=>e.textContent.trim()));
    await pg.click('#sheet .btn.primary');
    // wait until the overlay actually closed before hunting the next slot —
    // otherwise a click can land in the between-turns window (disabled slots)
    await pg.waitForFunction(()=>!document.getElementById('overlay').classList.contains('show'), null, {timeout:5000}).catch(()=>{});
    await pg.waitForTimeout(250);
  }
  return titles;
}

(async()=>{
  await new Promise(r=>server.listen(8079,r));
  const base='http://localhost:8079/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});

  // --- turbo solo (classic + turbo difficulty) ---
  let {ctx,pg} = await newPage(browser, base);
  await pg.click('#players .row >> nth=1 >> .iconbtn');   // default is 2 players; solo test drops one
  await pg.click('.diffs .diff:has-text("⚡ Turbo")');
  await pg.click('text=⚡ Start turbo');
  await placeN(pg, 5);
  let sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/TURBO RUN/.test(sheet) || !/\/5/.test(sheet)) throw new Error('turbo solo results wrong: '+sheet.slice(0,140));
  const hasChal = /Challenge a friend/.test(sheet);
  console.log('turbo solo: results OK ·', sheet.match(/\d\/5/)[0], '· challenge button:', hasChal?'yes':'no');
  await ctx.close();

  // --- turbo 2 players: ranking screen ---
  ({ctx,pg} = await newPage(browser, base));
  await pg.click('.diffs .diff:has-text("⚡ Turbo")');   // default 2 players
  await pg.click('text=⚡ Start turbo');
  await placeN(pg, 10);   // 2 players x 5, reveal button rotates automatically
  sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/WINS/.test(sheet) || !(sheet.match(/\/5/g)||[]).length>=2) throw new Error('turbo multi ranking wrong: '+sheet.slice(0,160));
  const placed = await pg.$$eval('.placed', e=>e.length);
  if(placed !== 11){
    const st = await pg.evaluate(()=>({board:S.players[0].timeline.map(c=>c.name+':'+c.year+':o'+c.owner),
      tries:S.players.map(p=>p.tries), hits:S.players.map(p=>p.hits), deck:S.deck.length, used:S.used.size}));
    console.log('DEBUG state:', JSON.stringify(st,null,1));
    throw new Error('board not shared: expected 11 placed cards (1 anchor + 10 locked), got '+placed);
  }
  const colored = await pg.$$eval('.placed .yr[style]', e=>e.length);
  if(colored < 10) throw new Error('owner colors missing: only '+colored+' colored cards');
  console.log('turbo 2p: ranking OK · shared board (11 cards, '+colored+' colored)');
  await ctx.close();

  // --- daily: play, record, share text, challenge link out ---
  ({ctx,pg} = await newPage(browser, base));
  await pg.click('text=▶ Play');
  const titles1 = await placeN(pg, 5, true);
  sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/DAILY #/.test(sheet) || !/streak/.test(sheet)) throw new Error('daily results wrong: '+sheet.slice(0,140));
  // grab a challenge link from the daily result
  if(!/Challenge friends/.test(sheet)) throw new Error('daily results missing challenge button');
  await pg.click('text=⚔️ Challenge friends');
  await pg.waitForTimeout(300);
  const shared = await pg.evaluate(()=>window.__shared);
  const m = shared && shared.match(/#c=[\d.]+&s=\d+(?:&t=\d+)?/);
  if(!m) throw new Error('challenge link not in share text: '+shared);
  const chalHash = m[0];
  console.log('daily: results + challenge link OK ·', chalHash.slice(0,26)+'…');
  await pg.click('text=Done');
  await pg.waitForTimeout(400);
  const cardTxt = await pg.$eval('#app', e=>e.innerText);
  if(!/Done —/.test(cardTxt)) throw new Error('daily card not in done state');
  console.log('daily: played-today lock OK');
  await ctx.close();

  // --- daily determinism (fresh profile) ---
  ({ctx,pg} = await newPage(browser, base));
  await pg.click('text=▶ Play');
  const titles2 = await placeN(pg, 5, true);
  if(JSON.stringify(titles1)!==JSON.stringify(titles2)){
    console.log(' run1:',titles1.join(' | ')); console.log(' run2:',titles2.join(' | '));
    throw new Error('daily determinism FAIL');
  }
  console.log('daily determinism: OK');
  await ctx.close();

  // --- challenge roundtrip: open the shared link in a fresh profile ---
  ({ctx,pg} = await newPage(browser, base + chalHash));
  const setupTxt = await pg.$eval('#app', e=>e.innerText);
  if(!/friend challenge/i.test(setupTxt) || !/Beat their/.test(setupTxt)) throw new Error('challenge card missing on setup');
  await pg.click('.card:has-text("friend challenge") >> text=▶ Play');
  const titles3 = await placeN(pg, 5, true);
  sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/CHALLENGE/.test(sheet)) throw new Error('challenge results wrong: '+sheet.slice(0,140));
  if(!/beat their|Tied|They hold it|faster|Dead even/i.test(sheet)) throw new Error('challenge verdict line missing: '+sheet.slice(0,160));
  const sameSongs = JSON.stringify(titles3)===JSON.stringify(titles1);
  if(!sameSongs){
    console.log(' daily :',titles1.join(' | ')); console.log(' chall :',titles3.join(' | '));
    throw new Error('challenge songs differ from the shared run');
  }
  console.log('challenge roundtrip: same songs + verdict OK');
  await ctx.close();

  console.log('ALL RUN-MODE TESTS PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
