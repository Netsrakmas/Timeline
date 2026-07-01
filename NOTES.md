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
- [ ] **Real-device test** (esp. iPhone/Safari): iTunes preview match rate, iOS
      autoplay behavior on first tap, haptics (`navigator.vibrate`), and whether
      the CORS visualizer engages or falls back. Consider a small in-app
      diagnostics view.
- [x] ~~**Year-accuracy pass**~~ — **done**: 78 conflicts resolved + full 2187-song
      sweep (75 corrections). Residual minor items: (a) `Marshmello — "Wow."`
      looks like Post Malone's "Wow." (2018) mislabeled to the wrong artist —
      needs a human call, left as-is; (b) a few near-duplicate artist spellings
      exist (e.g. "Bee Gees"/"The Bee Gees", "KLF"/"The KLF") — harmless but
      could be normalized.
- [ ] **Yearworm domain + trademark check** (note: an "Earworm" board game
      exists — worth confirming no conflict).
- [ ] **Legal/launch posture:** iTunes previews are tolerated promotional use,
      not a license. Plan: launch free, add a takedown contact, do the accuracy
      + device test before ship. Worst case = takedown email / API cutoff
      (recoverable).
- [x] ~~Decide whether to merge `previews-rewrite` → `main`~~ — **done**: `main`
      now holds the iTunes build; `old` holds the Spotify version.
- [ ] **Play Store (Android TWA)** — see `TWA.md` for the full recipe. Blocked on a
      decision + your accounts: (a) **hosting domain** (custom domain like
      `yearworm.app` = clean asset-links, vs the free `netsrakmas.github.io`
      user-page route); (b) Play Console ($25) + signing keystore; (c) confirm
      previews actually play on a real Android device. `.well-known/assetlinks.json`
      is committed as a template (fill the SHA-256).
- [ ] (Optional) Try the lime or coral palette to compare against the gold.

## Quick start for a new session
> Continue on the Yearworm music game (`/home/user/Timeline`, branch
> `previews-rewrite`). Read `NOTES.md` first. Single-file iTunes-preview timeline
> game. Next I want to ___.
