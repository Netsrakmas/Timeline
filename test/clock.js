// E2E: the turn clock (tiebreaker) — a single turn adds at most 60s, and time
// while the page is hidden (locked phone / app switch) never counts.
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
  await new Promise(r=>server.listen(8074,r));
  const base='http://localhost:8074/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));

  // solo classic; mysteries all newer than the seeds so the LAST slot is always correct
  const tl = Array.from({length:3},(_,i)=>({id:'x'+i, name:'Seed '+i, artist:'Seeder', year:1900+i*10}));
  const deck = [{id:'d1', name:'Mystery One', artist:'M', year:1999, previewUrl: base+'clip.wav'},
                {id:'d2', name:'Mystery Two', artist:'M', year:2001, previewUrl: base+'clip.wav'},
                {id:'d3', name:'Mystery Three', artist:'M', year:2003, previewUrl: base+'clip.wav'}];
  const save = {v:2, target:10, turn:0, deck, used:['d1'], current: deck[0],
    players:[{name:'P1', timeline:tl}], mode:'classic', lives:3, score:0, streak:0, bestStreak:0};
  await pg.addInitScript(s=>{
    if(localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded','1');
    localStorage.setItem('tl_game', JSON.stringify(s));
  }, save);
  await pg.goto(base,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  await pg.click('button:has-text("Resume")');
  await pg.waitForSelector('.slot.active',{timeout:20000});

  // turn 1: pretend the player has been staring for 5 minutes -> capped at 60s
  await pg.evaluate(()=>{ S.turnStart = Date.now() - 300000; });
  await pg.click('.slot.active >> nth=-1');
  await pg.waitForSelector('#overlay.show',{timeout:5000});
  let t = await pg.evaluate(()=>S.players[0].timeMs);
  if(t > 60000 || t < 59000) throw new Error('cap failed: 5-minute turn recorded as '+t+'ms');
  console.log('per-turn cap: 5 min of dithering counts as '+(t/1000)+'s ✓');

  // turn 2: phone "locked" for ~1.5s mid-turn -> that stretch must not count
  await pg.click('#sheet .btn.primary');
  await pg.waitForSelector('.slot.active',{timeout:20000});
  await pg.evaluate(()=>{
    Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.waitForTimeout(1500);
  await pg.evaluate(()=>{
    Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.click('.slot.active >> nth=-1');
  await pg.waitForSelector('#overlay.show',{timeout:5000});
  const t2 = await pg.evaluate(()=>S.players[0].timeMs);
  const added = t2 - t;
  if(added > 1200) throw new Error('hidden time leaked into the clock: turn added '+added+'ms (>1.2s while ~1.5s was hidden)');
  console.log('hidden time parked: 1.5s locked phone added only '+added+'ms ✓');
  console.log('TURN-CLOCK TEST PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
