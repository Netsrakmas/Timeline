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
  const browser = await chromium.launch({executablePath:CHROME});
  const ctx = await browser.newContext({viewport:{width:540,height:1200},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await pg.route(/lb\.test/, route=>route.fulfill({contentType:'application/json',
    body: JSON.stringify({me:null,friends:[],requests:[],outgoing:0,inbox:[]}),
    headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type'}}));
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
  const sfxRes = await pg.evaluate(()=>{ try{ sfx('good'); sfx('bad'); sfx('win'); sfx('end'); return 'ok'; }catch(e){ return e.message; } });
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

  await browser.close(); server.close();
  console.log('UI CHROME TEST PASS ✓');
})().catch(e=>{ console.error('UI CHROME TEST FAIL ✗', e); process.exit(1); });
