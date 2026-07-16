// Fair race-to-N: the game ends only when the ROUND completes (equal turns),
// and a tie on cards is decided by total thinking time.
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
  await new Promise(r=>server.listen(8067,r));
  const base='http://localhost:8067/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));

  // both players already AT the target (10 cards, years 1900-1909). Placing in
  // the leftmost slot ("before 1900") is deterministically WRONG for any pool
  // song (all years >= 1955), so card counts stay tied at 10-10.
  const tl = pre => Array.from({length:10},(_,i)=>({id:pre+i, name:'Seed '+i, artist:'Seeder', year:1900+i}));
  const deck = [
    {id:'d1', name:'Mystery One', artist:'M', year:1999, previewUrl: base+'clip.wav'},
    {id:'d2', name:'Mystery Two', artist:'M', year:2001, previewUrl: base+'clip.wav'},
    {id:'d3', name:'Mystery Three', artist:'M', year:2003, previewUrl: base+'clip.wav'},
  ];
  const save = {v:2, target:10, turn:0, deck, used:['d1'],
    current: deck[0],
    players:[{name:'P1', timeline:tl('x')},{name:'P2', timeline:tl('y')}],
    mode:'classic', lives:3, score:0, streak:0, bestStreak:0};
  await pg.addInitScript(s=>localStorage.setItem('tl_game', JSON.stringify(s)), save);
  await pg.goto(base,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  await pg.click('button:has-text("Resume")');
  await pg.waitForSelector('.slot.active',{timeout:20000});

  // P1 places instantly (wrong on purpose) — game must NOT end
  await pg.click('.slot.active >> nth=0');
  await pg.waitForSelector('#overlay.show',{timeout:5000});
  let btn = await pg.$eval('#sheet .btn.primary', e=>e.textContent.trim());
  let sub = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/Pass to P2/.test(btn)) throw new Error('game ended before the round completed! btn='+btn);
  if(!/final round/i.test(sub)) throw new Error('no final-round notice: '+sub.slice(0,120));
  console.log('P1 done: game continues ("'+btn+'", final-round notice shown) OK');

  // P2's equalizing turn — deliberately slower, also wrong
  await pg.click('#sheet .btn.primary');
  await pg.waitForSelector('.slot.active',{timeout:20000});
  await pg.waitForTimeout(1800);                       // P2 thinks longer
  await pg.click('.slot.active >> nth=0');
  await pg.waitForSelector('#overlay.show',{timeout:5000});
  btn = await pg.$eval('#sheet .btn.primary', e=>e.textContent.trim());
  if(!/See results/.test(btn)) throw new Error('round complete but no results button: '+btn);
  console.log('P2 done: round closed, results offered OK');

  await pg.click('#sheet .btn.primary');
  await pg.waitForTimeout(400);
  const sheet = await pg.$eval('#sheet', e=>e.innerText.replace(/\s+/g,' '));
  if(!/P1 WINS/.test(sheet)) throw new Error('expected P1 (faster) to win the tie: '+sheet.slice(0,160));
  if(!/fastest time decides/i.test(sheet)) throw new Error('tie-break note missing: '+sheet.slice(0,160));
  if(!(/🏆 P1/.test(sheet))) throw new Error('winner crown missing: '+sheet.slice(0,160));
  console.log('tie 10-10 → fastest (P1) wins, tie-break note shown OK');
  console.log('FAIR-ROUND TEST PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
