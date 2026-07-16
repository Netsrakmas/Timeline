// Property test on the real pool: seeded run-sets are era-clustered (tight
// year spread), deterministic, and always deliver the requested count.
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
  await new Promise(r=>server.listen(8076,r));
  const browser = await chromium.launch({executablePath:CHROME});
  const ctx = await browser.newContext({serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await pg.goto('http://localhost:8076/',{waitUntil:'load'});
  await pg.waitForTimeout(500);

  const r = await pg.evaluate(()=>{
    const N = 10;                       // daily asks for RUN_LEN + 5
    const out = { spreads:[], bad:[], det:true, short:0, poolYears:null };
    const pool = stablePool();
    const ys = pool.map(s=>s.year);
    out.poolYears = [Math.min(...ys), Math.max(...ys), pool.length];
    for(let seed=1; seed<=60; seed++){
      const a = seededIdx(seed*99991, N), b = seededIdx(seed*99991, N);
      if(JSON.stringify(a)!==JSON.stringify(b)) out.det = false;
      if(a.length < N) out.short++;
      const years = a.map(i=>pool[i].year);
      const spread = Math.max(...years) - Math.min(...years);
      out.spreads.push(spread);
      if(spread > 2*RUN_YEAR_SPAN + 12) out.bad.push({seed, years:[...years].sort()});
    }
    return out;
  });

  console.log('pool:', r.poolYears[2], 'songs,', r.poolYears[0]+'–'+r.poolYears[1]);
  if(!r.det) throw new Error('seededIdx not deterministic');
  if(r.short) throw new Error(r.short+' seeds returned fewer than requested picks');
  const sorted = [...r.spreads].sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)], max = sorted[sorted.length-1];
  console.log('year spread over 60 seeded sets: median', median, '· max', max);
  if(median > 2*8) throw new Error('median spread '+median+' — sets are not clustered');
  if(r.bad.length > 6) throw new Error('too many wide sets ('+r.bad.length+'/60): '+JSON.stringify(r.bad.slice(0,3)));
  if(r.bad.length) console.log('note:', r.bad.length, 'sparse-era sets widened beyond the base window (allowed)');
  console.log('CLUSTER TEST PASS ✓ (deterministic, tight era windows)');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
