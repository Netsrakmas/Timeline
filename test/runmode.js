// E2E: turbo run (5 placements -> results) + daily determinism + share state.
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
async function newPage(browser, base){
  const ctx = await browser.newContext({viewport:{width:540,height:960},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await pg.route(/itunes\.apple\.com/, route=>{
    const u=new URL(route.request().url());const cb=u.searchParams.get('callback');const term=u.searchParams.get('term')||'x';
    route.fulfill({contentType:'text/javascript',body:`${cb}(${JSON.stringify({resultCount:1,results:[{trackId:++tid,trackName:term,artistName:term,collectionName:'T',releaseDate:'1999-01-01',previewUrl:base+'clip.wav'}]})})`});
  });
  await pg.goto(base,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  return {ctx,pg};
}
async function playRun(pg){
  // place 5 cards; reveal button label switches to results on the 5th
  for(let i=1;i<=5;i++){
    await pg.waitForSelector('.slot.active',{timeout:20000});
    await pg.click('.slot.active');
    await pg.waitForSelector('#overlay.show',{timeout:5000});
    const btn = await pg.$eval('#sheet .btn.primary', e=>e.textContent.trim());
    if(i<5 && !/Next song/.test(btn)) throw new Error(`song ${i}: unexpected button "${btn}"`);
    if(i===5 && !/results/.test(btn)) throw new Error(`song 5: expected results button, got "${btn}"`);
    await pg.click('#sheet .btn.primary');
    await pg.waitForTimeout(400);
  }
}

(async()=>{
  await new Promise(r=>server.listen(8079,r));
  const base='http://localhost:8079/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});

  // --- turbo ---
  let {ctx,pg} = await newPage(browser, base);
  await pg.click("text=⚡ Turbo");
  await pg.click("text=⚡ Start turbo run");
  await playRun(pg);
  let sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/TURBO RUN/.test(sheet) || !/\/5/.test(sheet)) throw new Error('turbo results screen wrong: '+sheet.slice(0,120));
  console.log('turbo: 5 placements -> results OK ·', sheet.match(/\d\/5/)[0]);
  // run again works
  await pg.click('text=Run it again');
  await pg.waitForSelector('.slot.active',{timeout:20000});
  console.log('turbo: replay starts OK');
  await ctx.close();

  // --- daily: play + record ---
  ({ctx,pg} = await newPage(browser, base));
  const num1 = await pg.$eval('.card .eyebrow', e=>e.textContent);   // daily card is first
  await pg.click('text=▶ Play');
  // capture the daily's first mystery via S? not reachable; instead capture deck order via reveal titles
  const titles=[];
  for(let i=1;i<=5;i++){
    await pg.waitForSelector('.slot.active',{timeout:20000});
    await pg.click('.slot.active');
    await pg.waitForSelector('#overlay.show',{timeout:5000});
    titles.push(await pg.$eval('.reveal-ti', e=>e.textContent.trim()));
    await pg.click('#sheet .btn.primary');
    await pg.waitForTimeout(350);
  }
  sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/DAILY #/.test(sheet) || !/streak/.test(sheet)) throw new Error('daily results screen wrong: '+sheet.slice(0,140));
  console.log('daily: results OK ·', (sheet.match(/DAILY #\d+/)||[])[0], '·', (sheet.match(/\d\/5/)||[])[0]);
  // back to setup: card should now show Done + Share
  await pg.click('text=Done');
  await pg.waitForTimeout(400);
  const cardTxt = await pg.$eval('#app', e=>e.innerText);
  if(!/Done —/.test(cardTxt) || !/Share/.test(cardTxt)) throw new Error('daily card not in done state');
  console.log('daily: played-today lock + share button OK');
  await ctx.close();

  // --- daily determinism: fresh profile, same 5 titles ---
  ({ctx,pg} = await newPage(browser, base));
  await pg.click('text=▶ Play');
  const titles2=[];
  for(let i=1;i<=5;i++){
    await pg.waitForSelector('.slot.active',{timeout:20000});
    await pg.click('.slot.active');
    await pg.waitForSelector('#overlay.show',{timeout:5000});
    titles2.push(await pg.$eval('.reveal-ti', e=>e.textContent.trim()));
    await pg.click('#sheet .btn.primary');
    await pg.waitForTimeout(350);
  }
  const same = JSON.stringify(titles)===JSON.stringify(titles2);
  console.log('daily determinism (two fresh profiles, same songs):', same?'OK':'FAIL');
  if(!same){ console.log(' run1:',titles.join(' | ')); console.log(' run2:',titles2.join(' | ')); process.exit(1); }
  await ctx.close();

  console.log('ALL RUN-MODE TESTS PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
