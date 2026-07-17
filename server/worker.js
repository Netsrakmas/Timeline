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
  const s = String(n == null ? "" : n).replace(/[^\p{L}\p{N} _\-.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
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

    return json({ error: "not found" }, 404, cors);
  }
};
