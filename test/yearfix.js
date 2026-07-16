// E2E: correcting a year in the reveal's 🚩 block must fix the card that is
// already locked on the timeline — repainted immediately, board re-sorted.
// Uses a RESUMED game: after a JSON round-trip the timeline card is a copy,
// not a deck reference, which was exactly the broken case.
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
  await new Promise(r=>server.listen(8073,r));
  const base='http://localhost:8073/';
  const browser = await chromium.launch({executablePath:CHROME,args:['--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({viewport:{width:540,height:1400},hasTouch:true,serviceWorkers:'block'});
  const pg = await ctx.newPage();
  pg.on('pageerror',e=>console.log('PAGEERROR:',e.message));

  // solo classic, 3 seed cards, current = Mystery One (1999) -> last slot is correct
  const tl = Array.from({length:3},(_,i)=>({id:'x'+i, name:'Seed '+i, artist:'Seeder', year:1900+i*10}));
  const deck = [{id:'d1', name:'Mystery One', artist:'M', year:1999, previewUrl: base+'clip.wav'},
                {id:'d2', name:'Mystery Two', artist:'M', year:2001, previewUrl: base+'clip.wav'}];
  const save = {v:2, target:10, turn:0, deck, used:['d1'], current: deck[0],
    players:[{name:'P1', timeline:tl}], mode:'classic', lives:3, score:0, streak:0, bestStreak:0};
  await pg.addInitScript(s=>{
    if(localStorage.getItem('__seeded')) return;   // runs on every navigation; seed only once
    localStorage.setItem('__seeded','1');
    localStorage.setItem('tl_game', JSON.stringify(s));
  }, save);
  await pg.goto(base,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  await pg.click('button:has-text("Resume")');
  await pg.waitForSelector('.slot.active',{timeout:20000});
  await pg.click('.slot.active >> nth=-1');       // 1999 after 1920 -> correct, locks on board
  await pg.waitForSelector('#overlay.show',{timeout:5000});

  // sanity: resumed timeline card is a different object than the deck card
  const distinct = await pg.evaluate(()=> S.players[0].timeline.find(c=>c.id==='d1') !== S.deck.find(c=>c.id==='d1'));
  if(!distinct) console.log('note: timeline card shares the deck reference (non-resume path)');

  // correct the year to 1905 -> card must move between Seed 0 (1900) and Seed 1 (1910)
  await pg.click('.report-yr summary');
  await pg.$eval('#sheet .rev-yr', e=>{ e.value = '1905'; e.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(300);

  const years = await pg.$$eval('.placed .yr', els=>els.map(e=>parseInt(e.textContent,10)).filter(n=>!isNaN(n)));
  if(!years.includes(1905)) throw new Error('board still shows the old year, years='+years.join(','));
  if(years.includes(1999)) throw new Error('old year 1999 still on the board, years='+years.join(','));
  const sorted = [...years].sort((a,b)=>a-b);
  if(JSON.stringify(years)!==JSON.stringify(sorted)) throw new Error('board not re-sorted: '+years.join(','));
  const st = await pg.evaluate(()=>({tl:S.players[0].timeline.map(c=>c.year), ov:S.yearOverrides['d1']}));
  if(st.ov!==1905 || !st.tl.includes(1905)) throw new Error('state not fixed: '+JSON.stringify(st));
  console.log('year fix: locked card updated + board re-sorted immediately ✓ years='+years.join(','));

  // the fix must survive the save/resume round-trip too
  await pg.click('#sheet .btn.primary');
  await pg.waitForTimeout(300);
  await pg.reload(); await pg.waitForTimeout(700);
  await pg.click('button:has-text("Resume")');
  await pg.waitForTimeout(500);
  const years2 = await pg.$$eval('.placed .yr', els=>els.map(e=>parseInt(e.textContent,10)).filter(n=>!isNaN(n)));
  if(!years2.includes(1905) || years2.includes(1999)) throw new Error('fix lost after reload+resume: '+years2.join(','));
  console.log('year fix survives save/resume: ✓ years='+years2.join(','));
  console.log('YEAR-FIX TEST PASS ✓');
  await browser.close(); server.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
