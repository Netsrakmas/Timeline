# Yearworm / Timeline — project notes

> **Heads-up:** the original `NOTES.md` was never pushed and was lost when this
> cloud clone was created. This file is **reconstructed from the code** as of
> commit `1c6f232`. Treat the "Pre-launch to-dos" as my best read of what's left
> before going live — correct, re-order, or delete anything that's wrong.

## What it is

A self-hosted, single-file PWA music game. Players hear a mystery track and slot
it into a shared timeline by **release year** — first to a run of N cards wins.
Playback runs through the player's own Spotify account.

- **`index.html`** — the entire app (UI, game logic, Spotify auth + playback).
- **`manifest.json`** — PWA manifest.
- **`sw.js`** — service worker (offline shell, cache `timeline-pwa-v12`).

## How it works today

- **Auth:** Spotify OAuth **PKCE** flow. Each user pastes their **own Client ID**
  and registers the redirect URI in their own Spotify developer app.
- **Playback:** Spotify **Web Playback SDK** (in-browser device) is the default so
  the track title stays hidden. Other Spotify Connect devices can be picked.
  **Requires Spotify Premium.**
- **Title masking:** the SDK/OS media-session metadata is overwritten with a decoy
  ("🎵 Timeline") + blank album art so the real title never leaks on the
  lock screen. A repaint loop re-stamps the decoy so even the first track can't
  leak past ~0.7s.
- **Deck:** built from a user-supplied Spotify **playlist** (`/playlists/{id}/items`,
  the post-Feb-2026 field names `.item` / `release_date`). Tracks with no usable
  release year are skipped.
- **Gameplay:** each player is seeded one freebie card; on a turn you tap the gap
  where the mystery track belongs; correct → card kept, wrong → discarded. Year
  can be hand-corrected on the reveal (`yearOverrides`, persisted locally).
- **Persistence:** game state auto-saves to `localStorage` each turn (resume after
  reload/crash). Client ID, playlist, token, and year overrides are also cached.
- **Difficulty:** card-count tiers — Easy Listening (10) / Music Buff (15) /
  Virtuoso (20) / Musical Genius (25).

## Pre-launch to-dos (reconstructed)

Priority: **P0** blocks a public launch · **P1** strongly wanted · **P2** nice-to-have.

- [ ] **P0 — Real PWA icons.** `manifest.json` ships an *empty* icon
  (`"src": "data:image/png;base64,"`) and only a 192px slot. Add real 192 + 512
  (and maskable) icons or the install/home-screen tile is broken.
- [ ] **P0 — Remove per-user Client ID friction.** Making every player create a
  Spotify dev app + paste a Client ID is fine for us but not for a public launch.
  Decide: ship one hosted app with an embedded (public/PKCE) Client ID + fixed
  redirect URI, and request Spotify **extended quota** (dev mode caps at 25
  users). Keep the paste-your-own path as an advanced fallback.
- [ ] **P0 — Hosting.** Serve over HTTPS at a stable URL; register that exact
  redirect URI. Confirm the SW `start_url`/scope work from the deployed path.
- [ ] **P1 — Premium requirement.** Web Playback SDK needs Premium, which excludes
  free users. Decide whether that's acceptable for launch or whether a
  preview-clip fallback is worth it (note: Spotify pulled `preview_url` from most
  API responses in late 2024, so this likely needs a non-Spotify preview source).
- [ ] **P1 — Bundle a default deck.** Right now play can't start without a
  user-supplied playlist, and non-owned playlists 403. Ship one or more curated
  built-in decks so a first-timer can start instantly.
- [ ] **P1 — Playlist-ownership limitation.** Code notes 403s on playlists the
  user doesn't own/collaborate on. Document this clearly in-app and/or lean on
  bundled decks.
- [ ] **P2 — Title-leak QA.** The media-session masking is clever but fragile;
  verify on target devices/browsers (iOS Safari, Android Chrome) that no title,
  artist, or album art leaks on lock screen or notification.
- [ ] **P2 — Cross-browser/device test pass.** iOS Safari PWA quirks, mobile
  autoplay unlock (`activateElement` inside a tap), Connect device hand-off.
- [ ] **P2 — Branding/legal.** Follow Spotify design guidelines + attribution;
  keep the "personal use" disclaimer honest for a public deploy.

## Dev notes / gotchas

- **Feb-2026 Spotify API changes** are already handled in code: playlist
  `/tracks` → `/items`, item `.track` → `.item`, and the `product` field removed
  from `/me` (Premium is only *assumed* now — free is flagged, not proven).
- Bump `CACHE_NAME` in `sw.js` on any shipped change or clients keep the old shell.
- Everything degrades gracefully when `localStorage` is unavailable (sandboxes).
- Global crash handlers surface errors in `#errbar` instead of white-screening;
  the game is auto-saved so a reload + Resume recovers.
</content>
</invoke>
