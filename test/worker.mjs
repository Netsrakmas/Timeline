// Unit test for server/worker.js with an in-memory fake of the D1 subset used.
// (SQL itself is exercised on deploy via a curl smoke test — this validates
// routing, validation, one-shot upsert semantics and rank math.)
const worker = (await import('/home/user/Timeline/server/worker.js')).default;

const rows = [];    // {day, device, nick, score, time_ms, created}
const chals = [];   // {setkey, device, nick, score, time_ms, created}
function fakeDB(){
  return { prepare(sql){ return { bind(...a){ return {
    async run(){
      if(/^INSERT INTO scores/.test(sql)){
        const [day, device, nick, score, time_ms, created] = a;
        const ex = rows.find(r=>r.day===day && r.device===device);
        if(ex){ ex.nick = nick; }   // ON CONFLICT: nick only
        else rows.push({day, device, nick, score, time_ms, created});
        return {};
      }
      if(/^INSERT INTO chals/.test(sql)){
        const [setkey, device, nick, score, time_ms, created] = a;
        const ex = chals.find(r=>r.setkey===setkey && r.device===device);
        if(ex){ ex.nick = nick; }
        else chals.push({setkey, device, nick, score, time_ms, created});
        return {};
      }
      throw new Error('unexpected run: '+sql);
    },
    async first(){
      if(/SELECT COUNT\(\*\) AS n FROM scores WHERE day=\?1 AND/.test(sql)){
        const [day, score, time_ms, created] = a;
        return { n: rows.filter(r=>r.day===day && (r.score>score || (r.score===score && r.time_ms<time_ms) || (r.score===score && r.time_ms===time_ms && r.created<created))).length };
      }
      if(/SELECT COUNT\(\*\) AS n FROM scores WHERE day=\?1$/.test(sql))
        return { n: rows.filter(r=>r.day===a[0]).length };
      if(/SELECT nick, score, time_ms, created FROM scores/.test(sql))
        return rows.find(r=>r.day===a[0] && r.device===a[1]) || null;
      throw new Error('unexpected first: '+sql);
    },
    async all(){
      if(/SELECT nick, score, time_ms FROM scores WHERE day=\?1 ORDER BY/.test(sql)){
        const day=a[0];
        const s=[...rows.filter(r=>r.day===day)].sort((x,y)=> y.score-x.score || x.time_ms-y.time_ms || x.created-y.created);
        return { results: s.slice(0,25) };
      }
      if(/SELECT nick, score, time_ms, device FROM chals WHERE setkey=\?1 ORDER BY/.test(sql)){
        const s=[...chals.filter(r=>r.setkey===a[0])].sort((x,y)=> y.score-x.score || x.time_ms-y.time_ms || x.created-y.created);
        return { results: s.slice(0,50) };
      }
      throw new Error('unexpected all: '+sql);
    },
  };}};}};
}
const env = { DB: fakeDB() };
const call = (method, path, body, origin) => worker.fetch(new Request('https://api.test'+path, {
  method, body: body?JSON.stringify(body):undefined,
  headers: { 'Origin': origin||'https://playyearworm.com', 'CF-Connecting-IP': '1.2.3.'+Math.floor(Math.random()*250) }
}), env);
const js = async r => ({ status: r.status, body: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') });

const DAILY_EPOCH = Date.UTC(2026, 6, 1);
const today = Math.max(1, Math.floor((Date.now()-DAILY_EPOCH)/864e5)+1);
const dev = n => n.repeat(32).slice(0,32);

// health + CORS
let r = await js(await call('GET','/health'));
if(!r.body.ok || r.body.day!==today) throw new Error('health wrong: '+JSON.stringify(r));
if(r.cors!=='https://playyearworm.com') throw new Error('cors wrong');
r = await js(await call('GET','/health',null,'https://evil.example'));
if(r.cors!=='https://playyearworm.com') throw new Error('foreign origin must not be echoed');

// validation
for(const bad of [
  {day:today+5, device:dev('a'), score:3, timeMs:9000},
  {day:today, device:'xyz', score:3, timeMs:9000},
  {day:today, device:dev('a'), score:9, timeMs:9000},
  {day:today, device:dev('a'), score:3, timeMs:10},
]){
  r = await js(await call('POST','/daily',bad));
  if(r.status!==400) throw new Error('should reject: '+JSON.stringify(bad));
}

// three players, ranking: score desc, then time asc
r = await js(await call('POST','/daily',{day:today, device:dev('a'), nick:'Sam', score:4, timeMs:20000}));
if(r.body.me.rank!==1) throw new Error('first submit should rank 1');
await call('POST','/daily',{day:today, device:dev('b'), nick:'B<script>', score:5, timeMs:30000});
r = await js(await call('POST','/daily',{day:today, device:dev('c'), nick:'Cee', score:4, timeMs:9000}));
if(r.body.total!==3) throw new Error('total wrong: '+r.body.total);
if(r.body.me.rank!==2) throw new Error('faster tie should rank 2, got '+r.body.me.rank);
if(r.body.top[0].nick!=='Bscript') throw new Error('nick not sanitized: '+r.body.top[0].nick);
if(r.body.top.map(t=>t.nick).join()!=='Bscript,Cee,Sam') throw new Error('order wrong: '+r.body.top.map(t=>t.nick));

// one-shot: resubmitting a better score must NOT overwrite, only the nick updates
r = await js(await call('POST','/daily',{day:today, device:dev('a'), nick:'Sammy', score:5, timeMs:1000}));
if(r.body.me.score!==4 || r.body.me.nick!=='Sammy') throw new Error('one-shot upsert broken: '+JSON.stringify(r.body.me));

// GET board with rank for a device
r = await js(await call('GET','/daily?device='+dev('a')));
if(r.body.me.rank!==3) throw new Error('GET rank wrong: '+JSON.stringify(r.body.me));
if(r.body.top.length!==3) throw new Error('top wrong');

// --- challenge-set boards ---
for(const bad of [
  {set:'abc', device:dev('a'), score:3, timeMs:9000},
  {set:'12', device:dev('a'), score:3, timeMs:9000},          // single index: not a set
  {set:'1.2.3', device:dev('a'), score:7, timeMs:9000},
]){
  r = await js(await call('POST','/chal',bad));
  if(r.status!==400) throw new Error('chal should reject: '+JSON.stringify(bad));
}
r = await js(await call('POST','/chal',{set:'10.20.30.40.50.60', device:dev('a'), nick:'Sam', score:3, timeMs:9000}));
if(r.body.total!==1 || !r.body.results[0].you) throw new Error('chal first submit wrong: '+JSON.stringify(r.body));
await call('POST','/chal',{set:'10.20.30.40.50.60', device:dev('b'), nick:'Jesse', score:4, timeMs:12000});
r = await js(await call('POST','/chal',{set:'10.20.30.40.50.60', device:dev('a'), nick:'Sammy', score:5, timeMs:800}));
const me2 = r.body.results.find(x=>x.you);
if(r.body.total!==2 || me2.score!==3 || me2.nick!=='Sammy') throw new Error('chal one-shot broken: '+JSON.stringify(r.body));
if(r.body.results[0].nick!=='Jesse') throw new Error('chal ranking wrong: '+JSON.stringify(r.body.results));
r = await js(await call('GET','/chal?set=10.20.30.40.50.60&device='+dev('b')));
if(r.body.total!==2 || !r.body.results.find(x=>x.you && x.nick==='Jesse')) throw new Error('chal GET wrong: '+JSON.stringify(r.body));
if(r.body.results.some(x=>x.device)) throw new Error('device tokens must not leak in chal results');
console.log('chal boards: validation, one-shot, ranking, you-flag, no device leak ✓');

console.log('WORKER TEST PASS ✓ (validation, sanitizing, one-shot upsert, tie-by-time ranking, CORS, chal boards)');
