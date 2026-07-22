// E2E: daily share image — a branded PNG goes through the share sheet with the
// text+link; every degraded environment falls back to the plain-text share.
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
  await new Promise(r=>server.listen(8086,r));
  const browser = await chromium.launch({executablePath:CHROME});
  const ctx = await browser.newContext({viewport:{width:540,height:1200},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await pg.goto('http://localhost:8086/',{waitUntil:'load'});
  await pg.waitForTimeout(800);

  const DAILY = { num:21, score:4, results:[true,true,false,true,true], timeMs:73000, streak:12, idx:[3,7,11,15,19,23], last:'x' };

  // 1) full path: canShare available → share sheet gets the PNG + the text/link
  let got = await pg.evaluate(async(d)=>{
    localStorage.setItem('tl_daily', JSON.stringify(d));
    const calls = [];
    navigator.canShare = data => true;
    navigator.share = data => { calls.push({ text:data.text, files:(data.files||[]).map(f=>({name:f.name,type:f.type,size:f.size})) }); return Promise.resolve(); };
    await shareDaily();
    return calls;
  }, DAILY);
  if(got.length !== 1) throw new Error('expected exactly one share call, got '+got.length);
  const f0 = got[0].files && got[0].files[0];
  if(!f0 || f0.type !== 'image/png' || !/yearworm-daily-21\.png/.test(f0.name)) throw new Error('share missing the PNG: '+JSON.stringify(got[0].files));
  if(f0.size < 20000) throw new Error('share image suspiciously small: '+f0.size+' bytes');
  if(!/Yearworm Daily #21 · 📼 90s Week 🎧 4\/5/.test(got[0].text) || !/#c=3\.7\.11/.test(got[0].text)) throw new Error('share text/link wrong: '+got[0].text);
  console.log('image share: PNG ('+f0.size+'b) + text + challenge link OK');

  // 2) share target refuses files (canShare({files}) false) → text-only share
  got = await pg.evaluate(async()=>{
    const calls = [];
    navigator.canShare = data => !(data && data.files);
    navigator.share = data => { calls.push({ text:data.text, hasFiles: !!data.files }); return Promise.resolve(); };
    await shareDaily();
    return calls;
  });
  if(got.length !== 1 || got[0].hasFiles || !/Yearworm Daily #21/.test(got[0].text)) throw new Error('text fallback wrong: '+JSON.stringify(got));
  console.log('no file support: falls back to the text share OK');

  // 3) user closes the share sheet (AbortError) → NO second prompt
  got = await pg.evaluate(async()=>{
    let calls = 0;
    navigator.canShare = data => true;
    navigator.share = data => { calls++; const e = new Error('cancel'); e.name='AbortError'; return Promise.reject(e); };
    await shareDaily();
    return calls;
  });
  if(got !== 1) throw new Error('canceled share should not re-prompt, saw '+got+' calls');
  console.log('canceled sheet: no double prompt OK');

  // 4) share throws a REAL error (not a cancel) → text fallback still fires
  got = await pg.evaluate(async()=>{
    const calls = [];
    let first = true;
    navigator.canShare = data => true;
    navigator.share = data => { calls.push(!!data.files);
      if(first && data.files){ first=false; return Promise.reject(new Error('DataError')); }
      return Promise.resolve(); };
    await shareDaily();
    return calls;
  });
  if(got.length !== 2 || got[1] !== false) throw new Error('failed file share should retry as text: '+JSON.stringify(got));
  console.log('broken file share: retries as text OK');

  await browser.close(); server.close();
  console.log('SHARE IMAGE TEST PASS ✓');
})().catch(e=>{ console.error('SHARE IMAGE TEST FAIL ✗', e); process.exit(1); });
