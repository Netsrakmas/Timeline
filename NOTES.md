# Yearworm — project notes & handoff

A music timeline guessing game (Hitster-style): hear a 30-second clip, place it
on your timeline by release year. Built to be **publishable** by using **iTunes
preview clips** instead of Spotify.

- **Working branch:** `previews-rewrite` (all real work lives here; `main` is stale)
- **Deploy:** GitHub Pages serves this branch. Pushes appear live after a short
  CDN/cache lag (~1–2 min). Hard-refresh (Cmd/Ctrl+Shift+R) or use incognito to
  see changes immediately.

## What it is
- Single-file web app: `index.html` (HTML + inline CSS + inline JS).
- PWA: `manifest.json` + `sw.js` (service worker, network-first). Icons:
  `icon-512/192/180.png`.
- Music: **iTunes Search API via JSONP** (`&callback=`) to dodge CORS; plays the
  30s `previewUrl` through an HTML5 `<audio loop>`.
- Two modes: **Pass & Play** (classic, race to a target of N, multi-player with a
  handoff screen) and **Survival** (solo, 3 lives, endless, personal bests).

## Architecture notes (where things live in index.html)
- `const DECKS = [...]` — 12 themed deck literals (still present, but hidden).
- `const EXTRA_SONGS = [...]` — large flat song pool (~1961 entries).
- `const PARTY_SONGS = [...]` — curated party-anthem list (793 unique) used to
  build the Party deck by key-matching against the pool.
- `(function buildBigDecks(){...})()` — builds a **deduped shared pool** from all
  themed decks + EXTRA_SONGS + PARTY_SONGS, then unshifts the 5 launch decks and
  `DECKS.splice(5)` to hide the themed ones. Song object shape:
  `{year:N, artist:"...", title:"..."}`.
- Deck picker: `deckChipHTML()` / `deckCarouselHTML()` (side-scroll, pages of 6),
  `toggleDeck()`, `tallyHTML()`/`updateTally()`.
- Playback: `unlockAudio()` (silent-WAV unlock), `playClip()`, `wireAudio()`,
  `onAudioFail()` (auto-skip dead previews), `pickBest()` (filters karaoke/tribute
  via `BADVER` regex, requires a real `previewUrl`).
- Loading is throttled/progressive: `resolveInitial`, `loadRest`, `resolveBatch`,
  `bgRun` cancel token — first few songs load, rest stream in the background.
- Visualizer: Web Audio `AnalyserNode` gated behind a CORS probe
  (`fetch(url,{mode:'cors'})`), falls back to CSS bars if cross-origin audio
  can't be routed (routing it without CORS would mute playback).
- localStorage: `tl_game` (resume), `tl_decks` (custom), `tl_years` (year
  overrides), `tl_best` (survival bests).

## Current deck lineup (all capped at 600)
| Deck          | Size | Range / theme            |
|---------------|------|--------------------------|
| Every Era     | 2187 | whole pool, any year (superset, hardest) |
| The Classics  | 600  | 1950s–1989               |
| The Hits      | 600  | 1990–2009                |
| Now           | 600  | 2010–now                 |
| Party Anthems | 600  | every era · dance floor  |

Chips show "600 songs · <range>". Every Era is intentionally the superset (holds
songs the 600-capped era decks drop) — not obsolete.

## Look & feel
- Palette: **teal + amber/gold** on a dark synthwave base. CSS tokens:
  `--gold:#FFC24B`, `--cyan:#8CEBFF`, base `#03050D`. (Deliberately moved off the
  hot-pink `#FF2F9E` to avoid looking like Hitster.)
- Icon: equalizer bars, amber→cyan gradient. Regenerate with
  `scratchpad/icon.svg` + `scratchpad/mkicon.js` (renders 512/192/180 via
  headless Chromium).
- Alt palette directions considered but not applied: electric lime + indigo;
  coral + teal. Easy one-pass swap if we want to compare.

## Testing / dev workflow
- Syntax check: extract the big inline `<script>` and `node --check` it.
- Smoke test: `scratchpad/smoke.js` — headless Chromium (`playwright-core` at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), stubs iTunes JSONP,
  walks setup → load → place → reveal → advance → deck builder. Run from the
  scratchpad dir. (One expected console error: `ERR_CONNECTION_CLOSED` from the
  stubbed preview — harmless.)
- Content generation: parallel `general-purpose` agents write song JSON to
  `scratchpad/*.json`, then a node integrate script cleans (`&amp;`→`&`), dedups
  by `norm(title|artist)`, and splices into `index.html`.

## Done recently
- Grew The Classics 517 → 600 (added 135 worldwide-famous pre-1990 songs).
- Added Party Anthems deck (600, all-era).
- Deck chips lead with song count + year range.
- Reskinned to teal + amber/gold; regenerated icon.
- Bumped SW cache to `yearworm-v2`.
- Promoted the iTunes rewrite to `main` (fast-forward); saved the old Spotify
  version as branch `old`. (`previews-rewrite` still leads with newest work.)
- **Android PWA hardening** (SW `yearworm-v3`): manifest `id`/`scope`/
  `orientation:portrait`/`categories` + `any`/`maskable` icons + 2 install
  screenshots; `viewport-fit=cover` + safe-area insets; apple/mobile PWA metas.
  Verified installable in headless Chromium. It's now installable on Android
  Chrome ("Add to Home screen").
- **Year-conflict pass**: found 78 songs stored with two different years across
  decks; resolved each to one canonical original-release year (WebSearch-verified
  via 4 agents), unified 103 literals. Re-scan confirms 0 remaining conflicts.
  Rule: earliest commercial release; for remix-hits use the famous version's year
  (Cheerleader→2014, Another Night→1994, 3 A.M. Eternal→1991).
- **Full year-accuracy sweep**: 12 agents audited all 2187 songs (WebSearch-
  verified), flagged consistently-wrong years. Applied 75 corrections (113
  literals) — mostly viral-old songs stored at their viral year (Another
  Love 2022→2012, Take Me to Church 2014→2013, Macarena 1987→1996, TSwift
  Cruel Summer 2023→2019, Beggin'/Måneskin 2021→2017). Rejected 2 rule-
  violating flags (Cherish, All Summer Long — stored album-year was already
  correct). Re-scan: 0 conflicts. App boots clean.

## TODO / open items
- [x] ~~**Real-device test**~~ — **done** (phone test passed: install + previews
      play). iOS/Safari still untested but no longer launch-blocking.
- [x] ~~**Year-accuracy pass**~~ — **done**: 78 conflicts resolved + full 2187-song
      sweep (75 corrections). Follow-up done too: normalized 28 artist-spelling
      variants (62 literals), which collapsed 18 hidden duplicate songs
      (pool 2187→2169) and surfaced+fixed one more conflict (Night Fever→1977).
      Residual: `Marshmello — "Wow."` is probably Post Malone's song mislabeled;
      owner said leave it.
- [x] ~~**Yearworm domain + trademark check**~~ — **researched, looks clear**:
      no product/app/game named "Yearworm" exists anywhere findable; the
      "Earworm" board game (VStheUNIVERSE, Kickstarter/BGG) is a hum-the-song
      party game — different name, different mechanic, and "earworm" is a
      generic English word (weak mark). No active site at yearworm.com/.app;
      registry lookup blocked from sandbox, so **final 30-second availability
      check at a registrar is on the owner** before buying. Real comparable
      remains Hitster (mechanic can't be trademarked; name/trade-dress already
      avoided via rename + palette shift).
- [ ] **Legal/launch posture:** iTunes previews are tolerated promotional use,
      not a license. Plan: launch free, add a takedown contact, do the accuracy
      + device test before ship. Worst case = takedown email / API cutoff
      (recoverable).
- [x] ~~Decide whether to merge `previews-rewrite` → `main`~~ — **done**: `main`
      now holds the iTunes build (kept in sync by fast-forward); `old` holds the
      Spotify version. Housekeeping: stray branch
      `claude/yearworm-music-game-qe009n` should be deleted via the GitHub UI
      (sandbox permission blocked remote deletion).
- [ ] **Play Store (Android TWA)** — see `TWA.md` for the full recipe. Domain
      **decided: custom `yearworm.app`** (owner to buy via Porkbun or Cloudflare
      — cheap ~$12–15/yr, free WHOIS privacy + free email forwarding; `.app` is
      HTTPS-only, which Pages already satisfies). Then: (a) owner registers +
      sets email forwarding `contact@yearworm.app` → personal Gmail; (b) I add
      `CNAME` + DNS records + point Pages at the domain; (c) Play Console ($25) +
      signing keystore; fill `.well-known/assetlinks.json` SHA-256.
      **Build-time note:** generate the TWA **with Play Billing capability
      enabled** even though launch is free — see monetization item below.
      **Prepped & ready** (in repo / `TWA.md`): `privacy.html` (Play requires a
      policy URL; app collects nothing → data-safety = "no data collected"),
      full listing copy, content-rating/data-safety answers, assetlinks template.
      **Still owner-only:** build the signed AAB on your machine (Bubblewrap),
      $25 Play Console, signing keystore — can't be done from the sandbox.
      **Asset-links needs a domain root**, so Play verification is gated on
      either buying `yearworm.app` (recommended) or hosting assetlinks via a
      `netsrakmas.github.io` user-pages repo.
- [ ] **Monetization — DEFERRED (ship 100% free first).** Plan if/when wanted:
      sell **curated deck packs** (e.g. "90s Hip-Hop", "Christmas", "Movie
      Themes"). Curation/convenience is the real value — the free "build your own
      deck" feature doesn't cannibalize it (people are lazy). Delivery: **Google
      Play Billing inside the Android app** (native one-tap, Google handles
      payment/entitlement/restore; Play policy requires Play Billing for digital
      goods — no Stripe in-app). Web PWA would need Stripe/Lemon Squeezy + a
      license-key/import flow (clunkier, cross-device restore is the friction).
      Adding this later is a normal update, NOT a rewrite: web/PWA changes ship
      instantly via the SW; the TWA wraps the live site so most changes need no
      Play resubmission — BUT enabling Play Billing is a build-time wrapper
      capability, so **build the TWA with it on now** to avoid a later rebuild.
      Licensing caveat: frame as selling *curation*, not the (unlicensed) audio;
      selling raises takedown risk, so keep it modest. Tiny optional code hooks
      to pre-stage (not yet added): a `premium:true` deck flag + an `unlocked`
      set in localStorage (currently a no-op gate).
- [ ] **v2 idea — multi-device / remote multiplayer (DEFERRED, big feature).**
      Today's Pass & Play already covers *in-person* (one phone passed around);
      the unique value of multi-device is **remote play** (players in different
      locations). It's the biggest item on the roadmap: breaks the serverless-
      static model (needs a realtime backend), plus a lobby/room system, a
      networked source-of-truth state model, a game-loop refactor (`nextTurn`/
      `chooseSlot`/`overlayReveal`/`advance` broadcast+receive instead of mutating
      local `S`), and reconnection handling. Approach if pursued: a **managed
      realtime service** (PartyKit / Cloudflare Durable Objects, or Firebase /
      Supabase Realtime) — NOT hand-rolled WebRTC (signaling/STUN/TURN/NAT pain)
      or a self-run server. Free tiers cover a small launch. Build only if players
      ask for remote play; not needed for the free launch.
- [x] ~~(Optional) lime or coral palette experiment~~ — **compared** (rendered A/B/C
      side-by-side); **keeping gold + cyan** (best hierarchy, no good/bad-color
      collision, no Spotify-green association, branding already built on it).

## Quick start for a new session
> Continue on the Yearworm music game (`/home/user/Timeline`, branch
> `previews-rewrite`). Read `NOTES.md` first. Single-file iTunes-preview timeline
> game. Next I want to ___.
