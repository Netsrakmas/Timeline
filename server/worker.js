// Yearworm API — daily leaderboard. Cloudflare Worker + D1 (SQLite).
// No accounts, no personal data: a random device token, a nickname, a score.
// First submission per (day, device) stands — same one-shot rule as the client.

const DAILY_EPOCH = Date.UTC(2026, 6, 1);        // #1 = 1 July 2026 (mirrors index.html)
const RUN_LEN = 5;
const TOP_N = 25;

const dayNow = () => Math.max(1, Math.floor((Date.now() - DAILY_EPOCH) / 864e5) + 1);

function corsHeaders(origin){
  const ok = origin && (origin === "https://playyearworm.com" || /^http:\/\/localhost(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://playyearworm.com",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}
const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, "content-type": "application/json" } });

function cleanNick(n){
  const s = String(n == null ? "" : n).replace(/[^\p{L}\p{N} _\-.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return s || "Player";
}

// best-effort burst limit per isolate (D1 stays the source of truth for one-shot)
const hits = new Map();
function limited(ip){
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, t: now };
  if(now - h.t > 60000){ h.n = 0; h.t = now; }
  h.n++;
  hits.set(ip, h);
  if(hits.size > 10000) hits.clear();
  return h.n > 30;
}

async function board(env, day, device, cors){
  const top = (await env.DB.prepare(
    "SELECT nick, score, time_ms FROM scores WHERE day=?1 ORDER BY score DESC, time_ms ASC, created ASC LIMIT " + TOP_N
  ).bind(day).all()).results || [];
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE day=?1").bind(day).first()).n;
  let me = null;
  if(device){
    const row = await env.DB.prepare("SELECT nick, score, time_ms, created FROM scores WHERE day=?1 AND device=?2")
      .bind(day, device).first();
    if(row){
      const better = (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM scores WHERE day=?1 AND (score>?2 OR (score=?2 AND time_ms<?3) OR (score=?2 AND time_ms=?3 AND created<?4))"
      ).bind(day, row.score, row.time_ms, row.created).first()).n;
      me = { nick: row.nick, score: row.score, timeMs: row.time_ms, rank: better + 1 };
    }
  }
  return json({ day, total, me,
    top: top.map(r => ({ nick: r.nick, score: r.score, timeMs: r.time_ms })) }, 200, cors);
}

const SET_RE = /^\d+(\.\d+){1,8}$/;   // pool indices joined with dots (anchor + up to 8)
const DEVICE_RE = /^[a-f0-9]{16,64}$/i;

/* ---------- social: users, friends, direct challenges ---------- */
const HANDLE_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-.]{1,18}[\p{L}\p{N}]$/u;   // 3–20 chars, no edge junk
// avatar token: a generated-avatar id (m:NN) or a short legacy emoji; kept tiny
const AVATAR_RE = /^(m:\d{1,3}|.{1,8})$/u;
function validAvatar(v){ v = String(v == null ? "" : v); return AVATAR_RE.test(v) ? v : null; }
function friendCode(){
  const A = "ABCDEFGHJKMNPQRSTVWXYZ23456789";   // no 0/O/1/I/L/U lookalikes
  let s = ""; for(let i=0;i<6;i++) s += A[Math.floor(Math.random()*A.length)];
  return "YW-" + s;
}
function randId(){
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
const pair = (u1, u2) => u1 < u2 ? [u1, u2] : [u2, u1];

/* ---------- Google Sign-In (dark until GOOGLE_CLIENT_ID is set) ----------
   The client sends the Google ID token (a JWT); we verify it against
   Google's published keys — signature, issuer, audience, expiry — and use
   the stable `sub` as the account key. */
let _jwks = null, _jwksAt = 0;
async function googleKeys(){
  if(_jwks && _jwks.length && Date.now() - _jwksAt < 3600e3) return _jwks;
  try{
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if(!r.ok) return _jwks || [];        // don't cache a failure for an hour
    const b = await r.json();
    if(b && Array.isArray(b.keys) && b.keys.length){ _jwks = b.keys; _jwksAt = Date.now(); }
    return _jwks || [];
  }catch(e){ return _jwks || []; }
}
function b64uToBytes(s){
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while(s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function verifyGoogleToken(cred, clientId){
  const parts = String(cred || "").split(".");
  if(parts.length !== 3) return null;
  let header, payload;
  try{
    header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
  }catch(e){ return null; }
  if(header.alg !== "RS256") return null;
  if(payload.aud !== clientId) return null;
  if(payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
  if(!payload.exp || payload.exp * 1000 < Date.now()) return null;
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if(!jwk) return null;
  try{
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
      b64uToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? payload : null;
  }catch(e){ return null; }
}
async function freeHandle(env, base){
  base = String(base || "").replace(/[^\p{L}\p{N} _\-.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if(base.length < 3) base = "Player";
  for(let n = 0; n < 100; n++){
    const h = n === 0 ? base : base + " " + (n + 1);
    if(!HANDLE_RE.test(h)) continue;
    const taken = await env.DB.prepare("SELECT id FROM users WHERE handle_lc=?1").bind(h.toLowerCase()).first();
    if(!taken) return h;
  }
  return "Player " + Math.floor(Math.random() * 100000);
}

async function userByDevice(env, device){
  return env.DB.prepare(
    "SELECT u.id, u.handle, u.code FROM devices d JOIN users u ON u.id = d.user_id WHERE d.device=?1"
  ).bind(device).first();
}
async function socialState(env, me, cors){
  const rows = (await env.DB.prepare(
    "SELECT a, b, requester, status FROM friends WHERE a=?1 OR b=?1"
  ).bind(me.id).all()).results || [];
  const ids = [...new Set(rows.map(r => r.a === me.id ? r.b : r.a))];
  const named = {};
  for(const id of ids.slice(0, 100)){
    const u = await env.DB.prepare("SELECT id, handle FROM users WHERE id=?1").bind(id).first();
    if(u) named[id] = u.handle;
  }
  // profile pictures for those users, one batched query. Wrapped so a server
  // running before the `avatar` column migration simply returns no avatars.
  const avatars = {};
  const capIds = ids.slice(0, 100);
  if(capIds.length){ try{
    const q = "SELECT id, avatar FROM users WHERE id IN (" + capIds.map((_, i) => "?" + (i + 1)).join(",") + ")";
    for(const r of ((await env.DB.prepare(q).bind(...capIds).all()).results || [])) if(r.avatar) avatars[r.id] = r.avatar;
  }catch(e){} }
  // head-to-head duel tallies per friend, from my perspective (w = my wins),
  // plus a rolling last-7-days window and the most recent duels for the
  // friend-detail sheet
  const drows = (await env.DB.prepare(
    "SELECT a, b, winner, score_a, score_b, created FROM duels WHERE a=?1 OR b=?1 ORDER BY created DESC"
  ).bind(me.id).all()).results || [];
  const week = Date.now() - 7 * 864e5;
  const tally = {};
  for(const d of drows){
    const other = d.a === me.id ? d.b : d.a;
    const t = tally[other] || (tally[other] = { w:0, l:0, t:0, w7:0, l7:0, t7:0, recent:[] });
    const res = d.winner === me.id ? "w" : d.winner === other ? "l" : "t";
    t[res]++;
    if(d.created >= week) t[res + "7"]++;
    if(t.recent.length < 6) t.recent.push({
      r: res,
      mine: d.a === me.id ? d.score_a : d.score_b,
      theirs: d.a === me.id ? d.score_b : d.score_a,
      at: d.created
    });
  }
  const friends = [], requests = []; let outgoing = 0;
  for(const r of rows){
    const other = r.a === me.id ? r.b : r.a;
    if(!(other in named)) continue;
    if(r.status === "accepted"){
      const t = tally[other] || { w:0, l:0, t:0, w7:0, l7:0, t7:0, recent:[] };
      friends.push({ id: other, handle: named[other], avatar: avatars[other] || null, w: t.w, l: t.l, t: t.t,
                     w7: t.w7, l7: t.l7, t7: t.t7, recent: t.recent });
    }
    else if(r.requester === me.id) outgoing++;
    else requests.push({ id: other, handle: named[other], avatar: avatars[other] || null });
  }
  const inbox = ((await env.DB.prepare(
    "SELECT id, from_user, kind, payload, created FROM inbox WHERE to_user=?1 AND seen=0 ORDER BY created DESC LIMIT 20"
  ).bind(me.id).all()).results || []).map(m => ({
    id: m.id, from: m.from_user, handle: named[m.from_user] || "?", avatar: avatars[m.from_user] || null, kind: m.kind,
    payload: (()=>{ try{ return JSON.parse(m.payload); }catch(e){ return {}; } })(), created: m.created
  }));
  // inbox senders might not be resolved yet (named only covers friend rows)
  for(const m of inbox){
    if(m.handle === "?"){
      const u = await env.DB.prepare("SELECT handle FROM users WHERE id=?1").bind(m.from).first();
      if(u) m.handle = u.handle;
    }
  }
  const linked = await env.DB.prepare("SELECT user_id FROM logins WHERE user_id=?1 LIMIT 1").bind(me.id).first();
  let myAv = null; try{ const a = await env.DB.prepare("SELECT avatar FROM users WHERE id=?1").bind(me.id).first(); myAv = a && a.avatar || null; }catch(e){}
  return json({ me: { handle: me.handle, code: me.code, linked: !!linked, avatar: myAv }, friends, requests, outgoing, inbox }, 200, cors);
}
async function handleSocialPost(env, b, cors){
  const device = String(b.device || "");
  if(!DEVICE_RE.test(device)) return json({ error: "bad device" }, 400, cors);
  const action = String(b.action || "");
  let me = await userByDevice(env, device);

  // keep the caller's profile picture fresh on every state/claim/etc. Wrapped so
  // a server deployed before the `avatar` column migration can't 500 on it.
  const av = validAvatar(b.avatar);
  if(me && av){ try{ await env.DB.prepare("UPDATE users SET avatar=?1 WHERE id=?2").bind(av, me.id).run(); }catch(e){} }

  if(action === "claim"){
    const handle = String(b.handle || "").replace(/\s+/g, " ").trim();
    if(!HANDLE_RE.test(handle)) return json({ error: "bad handle" }, 400, cors);
    const taken = await env.DB.prepare("SELECT id FROM users WHERE handle_lc=?1").bind(handle.toLowerCase()).first();
    if(me){
      if(taken && taken.id !== me.id) return json({ error: "handle taken" }, 409, cors);
      await env.DB.prepare("UPDATE users SET handle=?1, handle_lc=?2 WHERE id=?3")
        .bind(handle, handle.toLowerCase(), me.id).run();
      me.handle = handle;
      return socialState(env, me, cors);
    }
    if(taken) return json({ error: "handle taken" }, 409, cors);
    const id = randId(), code = friendCode();
    await env.DB.prepare("INSERT INTO users (id, handle, handle_lc, code, created) VALUES (?1,?2,?3,?4,?5)")
      .bind(id, handle, handle.toLowerCase(), code, Date.now()).run();
    await env.DB.prepare("INSERT INTO devices (device, user_id, created) VALUES (?1,?2,?3) ON CONFLICT(device) DO UPDATE SET user_id=excluded.user_id")
      .bind(device, id, Date.now()).run();
    me = { id, handle, code };
    if(av){ try{ await env.DB.prepare("UPDATE users SET avatar=?1 WHERE id=?2").bind(av, id).run(); }catch(e){} }
    return socialState(env, me, cors);
  }

  if(action === "state"){
    // POST twin of GET /social — keeps the device token out of URL/proxy logs
    if(!me) return json({ me: null }, 200, cors);
    return socialState(env, me, cors);
  }

  if(!me) return json({ error: "no profile" }, 401, cors);

  if(action === "add"){
    const code = String(b.code || "").trim().toUpperCase();
    const other = await env.DB.prepare("SELECT id, handle FROM users WHERE code=?1").bind(code).first();
    if(!other) return json({ error: "code not found" }, 404, cors);
    if(other.id === me.id) return json({ error: "that is your own code" }, 400, cors);
    const [a, bb] = pair(me.id, other.id);
    const ex = await env.DB.prepare("SELECT requester, status FROM friends WHERE a=?1 AND b=?2").bind(a, bb).first();
    if(ex){
      // legacy pending rows (from the old request flow) resolve on any re-add
      if(ex.status === "pending")
        await env.DB.prepare("UPDATE friends SET status='accepted' WHERE a=?1 AND b=?2").bind(a, bb).run();
      // already friends: fine, fall through to state
    } else {
      // adding by code IS mutual consent — the code owner shared it, so no
      // accept round-trip: instant friendship + a courtesy note in their inbox
      await env.DB.prepare("INSERT INTO friends (a, b, requester, status, created) VALUES (?1,?2,?3,'accepted',?4)")
        .bind(a, bb, me.id, Date.now()).run();
      await env.DB.prepare("INSERT INTO inbox (to_user, from_user, kind, payload, created) VALUES (?1,?2,'friend',?3,?4)")
        .bind(other.id, me.id, "{}", Date.now()).run();
    }
    return socialState(env, me, cors);
  }

  if(action === "accept" || action === "decline" || action === "remove"){
    const other = String(b.user || "");
    const [a, bb] = pair(me.id, other);
    if(action === "accept"){
      const ex = await env.DB.prepare("SELECT requester, status FROM friends WHERE a=?1 AND b=?2").bind(a, bb).first();
      if(ex && ex.status === "pending" && ex.requester !== me.id)
        await env.DB.prepare("UPDATE friends SET status='accepted' WHERE a=?1 AND b=?2").bind(a, bb).run();
    } else {
      await env.DB.prepare("DELETE FROM friends WHERE a=?1 AND b=?2").bind(a, bb).run();
    }
    return socialState(env, me, cors);
  }

  if(action === "challenge"){
    const to = String(b.to || "");
    const set = String(b.set || "");
    const score = parseInt(b.score, 10);
    // clamp like /daily and /chal do — no negative/absurd times into the tie-break
    const timeMs = Math.min(RUN_LEN * 70000, Math.max(0, parseInt(b.timeMs, 10) || 0));
    if(!SET_RE.test(set)) return json({ error: "bad set" }, 400, cors);
    if(!Number.isFinite(score) || score < 0 || score > RUN_LEN) return json({ error: "bad score" }, 400, cors);
    const [a, bb] = pair(me.id, to);
    const fr = await env.DB.prepare("SELECT status FROM friends WHERE a=?1 AND b=?2").bind(a, bb).first();
    if(!fr || fr.status !== "accepted") return json({ error: "not a friend" }, 403, cors);
    await env.DB.prepare("INSERT INTO inbox (to_user, from_user, kind, payload, created) VALUES (?1,?2,'challenge',?3,?4)")
      .bind(to, me.id, JSON.stringify({ set, score, timeMs }), Date.now()).run();
    return socialState(env, me, cors);
  }

  if(action === "react"){
    // structured reactions only — a fixed emoji set, no free text ever
    const REACTIONS = ["🔥","😱","😂","👏","🎯","GG"];
    const to = String(b.to || "");
    const emoji = String(b.emoji || "");
    const score = Number.isFinite(parseInt(b.score, 10)) ? parseInt(b.score, 10) : null;
    if(!REACTIONS.includes(emoji)) return json({ error: "bad reaction" }, 400, cors);
    const [a, bb] = pair(me.id, to);
    const fr = await env.DB.prepare("SELECT status FROM friends WHERE a=?1 AND b=?2").bind(a, bb).first();
    if(!fr || fr.status !== "accepted") return json({ error: "not a friend" }, 403, cors);
    await env.DB.prepare("INSERT INTO inbox (to_user, from_user, kind, payload, created) VALUES (?1,?2,'react',?3,?4)")
      .bind(to, me.id, JSON.stringify({ emoji, score }), Date.now()).run();
    return socialState(env, me, cors);
  }

  if(action === "result"){
    // opponent finished an inbox challenge: record the duel (first report
    // stands — msg_id is UNIQUE) and tell the challenger how it went
    const msgId = parseInt(b.id, 10);
    const score = parseInt(b.score, 10);
    const timeMs = Math.min(RUN_LEN * 70000, Math.max(0, parseInt(b.timeMs, 10) || 0));
    if(!Number.isFinite(msgId)) return json({ error: "bad id" }, 400, cors);
    if(!Number.isFinite(score) || score < 0 || score > RUN_LEN) return json({ error: "bad score" }, 400, cors);
    const m = await env.DB.prepare(
      "SELECT from_user, kind, payload FROM inbox WHERE id=?1 AND to_user=?2"
    ).bind(msgId, me.id).first();
    if(!m || m.kind !== "challenge") return json({ error: "not found" }, 404, cors);
    let pay = {}; try{ pay = JSON.parse(m.payload); }catch(e){}
    const sa = Number.isFinite(parseInt(pay.score, 10)) ? parseInt(pay.score, 10) : null;
    const ta = parseInt(pay.timeMs, 10) || 0;
    // score first; equal scores fall to the fastest time; else a tie
    const winner = sa == null ? "" :
      score > sa ? me.id : score < sa ? m.from_user :
      (ta && timeMs && timeMs !== ta) ? (timeMs < ta ? me.id : m.from_user) : "";
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO duels (msg_id, a, b, score_a, score_b, time_a, time_b, winner, created) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    ).bind(msgId, m.from_user, me.id, sa, score, ta, timeMs, winner, Date.now()).run();
    if(ins.meta && ins.meta.changes === 0) return socialState(env, me, cors);   // already recorded
    await env.DB.prepare("INSERT INTO inbox (to_user, from_user, kind, payload, created) VALUES (?1,?2,'result',?3,?4)")
      .bind(m.from_user, me.id, JSON.stringify({
        score, timeMs, w: winner === m.from_user ? "you" : winner === me.id ? "them" : "tie"
      }), Date.now()).run();
    return socialState(env, me, cors);
  }

  if(action === "seen"){
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(n => parseInt(n, 10)).filter(Number.isFinite).slice(0, 50);
    for(const id of ids)
      await env.DB.prepare("UPDATE inbox SET seen=1 WHERE id=?1 AND to_user=?2").bind(id, me.id).run();
    return socialState(env, me, cors);
  }

  return json({ error: "bad action" }, 400, cors);
}

async function chalBoardResp(env, setkey, device, cors){
  const rows = (await env.DB.prepare(
    "SELECT nick, score, time_ms, device FROM chals WHERE setkey=?1 ORDER BY score DESC, time_ms ASC, created ASC LIMIT 50"
  ).bind(setkey).all()).results || [];
  return json({ set: setkey, total: rows.length,
    results: rows.map(r => ({ nick: r.nick, score: r.score, timeMs: r.time_ms, you: !!device && r.device === device })) }, 200, cors);
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get("Origin"));
    if(req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    if(limited(ip)) return json({ error: "slow down" }, 429, cors);

    if(url.pathname === "/health") return json({ ok: true, day: dayNow() }, 200, cors);

    if(url.pathname === "/daily" && req.method === "GET"){
      const day = Math.min(Math.max(parseInt(url.searchParams.get("day") || dayNow(), 10) || dayNow(), 1), dayNow() + 1);
      const device = (url.searchParams.get("device") || "").slice(0, 64);
      return board(env, day, /^[a-f0-9]{16,64}$/i.test(device) ? device : null, cors);
    }

    if(url.pathname === "/daily" && req.method === "POST"){
      let b; try{ b = await req.json(); }catch(e){ return json({ error: "bad json" }, 400, cors); }
      const day = parseInt(b.day, 10);
      const score = parseInt(b.score, 10);
      const timeMs = parseInt(b.timeMs, 10);
      const device = String(b.device || "");
      if(!Number.isFinite(day) || Math.abs(day - dayNow()) > 1) return json({ error: "bad day" }, 400, cors);
      if(!/^[a-f0-9]{16,64}$/i.test(device)) return json({ error: "bad device" }, 400, cors);
      if(!Number.isFinite(score) || score < 0 || score > RUN_LEN) return json({ error: "bad score" }, 400, cors);
      if(!Number.isFinite(timeMs) || timeMs < 500 || timeMs > RUN_LEN * 70000) return json({ error: "bad time" }, 400, cors);
      const nick = cleanNick(b.nick);
      // first run stands; a resubmit may only refresh the nickname
      await env.DB.prepare(
        "INSERT INTO scores (day, device, nick, score, time_ms, created) VALUES (?1,?2,?3,?4,?5,?6) " +
        "ON CONFLICT(day, device) DO UPDATE SET nick=excluded.nick"
      ).bind(day, device, nick, score, timeMs, Date.now()).run();
      return board(env, day, device, cors);
    }

    if(url.pathname === "/chal" && req.method === "GET"){
      const set = url.searchParams.get("set") || "";
      if(!SET_RE.test(set)) return json({ error: "bad set" }, 400, cors);
      const device = (url.searchParams.get("device") || "").slice(0, 64);
      return chalBoardResp(env, set, /^[a-f0-9]{16,64}$/i.test(device) ? device : null, cors);
    }

    if(url.pathname === "/chal" && req.method === "POST"){
      let b; try{ b = await req.json(); }catch(e){ return json({ error: "bad json" }, 400, cors); }
      const set = String(b.set || "");
      const score = parseInt(b.score, 10);
      const timeMs = parseInt(b.timeMs, 10);
      const device = String(b.device || "");
      if(!SET_RE.test(set)) return json({ error: "bad set" }, 400, cors);
      if(!/^[a-f0-9]{16,64}$/i.test(device)) return json({ error: "bad device" }, 400, cors);
      if(!Number.isFinite(score) || score < 0 || score > RUN_LEN) return json({ error: "bad score" }, 400, cors);
      if(!Number.isFinite(timeMs) || timeMs < 500 || timeMs > RUN_LEN * 70000) return json({ error: "bad time" }, 400, cors);
      const nick = cleanNick(b.nick);
      // one shot per set per device — first result stands, resubmits refresh the nick
      await env.DB.prepare(
        "INSERT INTO chals (setkey, device, nick, score, time_ms, created) VALUES (?1,?2,?3,?4,?5,?6) " +
        "ON CONFLICT(setkey, device) DO UPDATE SET nick=excluded.nick"
      ).bind(set, device, nick, score, timeMs, Date.now()).run();
      return chalBoardResp(env, set, device, cors);
    }

    if(url.pathname === "/social" && req.method === "GET"){
      const device = (url.searchParams.get("device") || "").slice(0, 64);
      if(!DEVICE_RE.test(device)) return json({ error: "bad device" }, 400, cors);
      const me = await userByDevice(env, device);
      if(!me) return json({ me: null }, 200, cors);
      return socialState(env, me, cors);
    }

    if(url.pathname === "/social" && req.method === "POST"){
      let b; try{ b = await req.json(); }catch(e){ return json({ error: "bad json" }, 400, cors); }
      return handleSocialPost(env, b, cors);
    }

    if(url.pathname === "/auth" && req.method === "POST"){
      let b; try{ b = await req.json(); }catch(e){ return json({ error: "bad json" }, 400, cors); }
      const device = String(b.device || "");
      if(!DEVICE_RE.test(device)) return json({ error: "bad device" }, 400, cors);
      if(!env.GOOGLE_CLIENT_ID) return json({ error: "login not configured" }, 503, cors);
      const tok = await verifyGoogleToken(b.credential, env.GOOGLE_CLIENT_ID);
      if(!tok || !tok.sub) return json({ error: "invalid token" }, 401, cors);
      const sub = String(tok.sub);
      const existing = await env.DB.prepare("SELECT user_id FROM logins WHERE provider='google' AND subject=?1").bind(sub).first();
      let me = await userByDevice(env, device);
      if(existing){
        // returning player (possibly on a new phone): this device becomes theirs
        const u = await env.DB.prepare("SELECT id, handle, code FROM users WHERE id=?1").bind(existing.user_id).first();
        if(!u) return json({ error: "account missing" }, 500, cors);
        await env.DB.prepare("INSERT INTO devices (device, user_id, created) VALUES (?1,?2,?3) ON CONFLICT(device) DO UPDATE SET user_id=excluded.user_id")
          .bind(device, u.id, Date.now()).run();
        me = u;
      } else if(me){
        // first sign-in: attach Google to the profile this device already has
        await env.DB.prepare("INSERT INTO logins (provider, subject, user_id, email, created) VALUES ('google',?1,?2,?3,?4)")
          .bind(sub, me.id, tok.email || null, Date.now()).run();
      } else {
        // brand-new player signing in before claiming: make them an account
        const handle = await freeHandle(env, tok.given_name || tok.name);
        const id = randId(), code = friendCode();
        await env.DB.prepare("INSERT INTO users (id, handle, handle_lc, code, created) VALUES (?1,?2,?3,?4,?5)")
          .bind(id, handle, handle.toLowerCase(), code, Date.now()).run();
        await env.DB.prepare("INSERT INTO devices (device, user_id, created) VALUES (?1,?2,?3) ON CONFLICT(device) DO UPDATE SET user_id=excluded.user_id")
          .bind(device, id, Date.now()).run();
        await env.DB.prepare("INSERT INTO logins (provider, subject, user_id, email, created) VALUES ('google',?1,?2,?3,?4)")
          .bind(sub, id, tok.email || null, Date.now()).run();
        me = { id, handle, code };
      }
      return socialState(env, me, cors);
    }

    return json({ error: "not found" }, 404, cors);
  }
};
