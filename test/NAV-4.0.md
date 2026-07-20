# 4.0 navigation contract (for updating the E2E tests)

The setup screen became a **tabbed lobby**. `renderSetup()` is now a router.
On load it shows the **Play tab home = a 5-card mode list**. The bottom nav
(Play/Friends/Ranks/Profile) only renders when `LB.url` is set.

## How to launch each mode (replaces the old setup buttons)

- **Daily**: `await pg.click('.modecard:has-text("Daily Challenge")')`
  (was `text=▶ Play`). Starts the daily immediately.
- **Pass & Play (classic)**: `await pg.click('.modecard:has-text("Pass & Play")')`
  → opens a **config screen** with the players list (`#players`), game-length
  chips (`#diffSel`, "first to N" — NO turbo chip here), the deck carousel,
  and the sticky **`▶ Start game`** button (same label as before). So the old
  `text=▶ Start game` still works, just click the Pass & Play mode card first.
- **Turbo**: `await pg.click('.modecard:has-text("Turbo")')` → config (players +
  decks) → `text=⚡ Start turbo` (same label). Turbo is its own mode now, NOT a
  game-length chip. Do NOT click a "⚡ Turbo" diff chip anymore.
- **Survival**: `await pg.click('.modecard:has-text("Survival")')` → config
  (`#soloName` + decks + best stats) → `text=🎯 Start survival`.
- **Fresh challenge / "challenge a friend"**:
  `await pg.click('.modecard:has-text("Challenges")')` → `startFreshChallenge()`
  (was the "challenge a friend" card / `text=▶ Go`).

## Where things moved

- `#players`, `#soloName`, `#diffSel`, deck carousel/chips, `▶ Start game` /
  `⚡ Start turbo` / `🎯 Start survival`: now on the per-mode **config screen**
  (after clicking the mode card). Config screens have a back button
  (`.backbtn`) and NO bottom nav.
- `#friendsCard` and `#chalNews`: now on the **Friends tab**. Reach it with
  `await pg.evaluate(()=>goTab('friends'))` (or click `.tab:has-text("Friends")`).
  Requires `LB.url` set (nav only shows then). `renderFriendsCard` still fills
  `#friendsCard` and `friendsCardHTML` is unchanged.
- The `.nickchip` and `#nickbar` still render on every lobby tab header.
- The daily **done** card text is now `Done · X/5 · streak 🔥N` (was `Done —`).
  Update any `/Done —/` assertion to `/Done ·/`.
- Standings: the "👥 friends ▸" `.eyebtn` header inside `#friendsCard` still
  opens `friendsOverview()` (Friends tab). There's also a Ranks tab.
- Challenge-link cards (incoming / your challenge / result) render on the Play
  home via `challengeCardHTML()` — same text as before ("friend challenge",
  "your challenge", "Beat their", "Send result", "Send your result back",
  "Rematch", "challenge result"), so those assertions on `#app` still pass;
  the link still greets with the `#overlay` Accept invite first.
- Direct helpers still exist and can be called via `pg.evaluate`: `startDaily()`,
  `startFreshChallenge()`, `startChallenge()`, `onStart()`, `setTarget(n)`,
  `goTab(t)`, `openMode('passplay'|'turbo'|'survival')`, `backToLobby()`.

## Rule
Keep each test's INTENT identical; only change the navigation to reach the same
screens. Do not weaken assertions. Every suite must still end with its
`… PASS ✓` line.
