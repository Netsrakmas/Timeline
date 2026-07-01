# Publishing Yearworm to the Google Play Store (TWA)

Yearworm is a PWA. To put it on Play, we wrap the live web app in a **Trusted Web
Activity (TWA)** — a thin Android shell that opens the PWA full-screen with no
browser UI. The web app stays the single source of truth; the store build just
points at the URL.

> Prereqs you own: a Google Play Console account (one-time **$25**), the live
> HTTPS site, and ~30 min. The heavy build step needs a local machine with
> Node + a JDK (it can't run in the Claude sandbox).

---

## Step 0 — Decide the hosting domain (do this first)

A "verified" TWA (no Chrome address bar) requires a **Digital Asset Links** file
served at the **domain root**:

    https://<domain>/.well-known/assetlinks.json

That constraint drives the domain choice:

| Option | App URL | assetlinks.json lives at | Notes |
|--------|---------|--------------------------|-------|
| **A. Custom domain** (recommended) | `https://yearworm.app/` | this repo's `/.well-known/assetlinks.json` → served at root ✓ | Best for launch + branding; ties into the "Yearworm domain" TODO. Needs a domain purchase + `CNAME`. |
| **B. github.io user page** | `https://netsrakmas.github.io/Timeline/` | `netsrakmas.github.io/.well-known/assetlinks.json` → **separate `netsrakmas.github.io` repo** | Free, but the asset-links file must live in your *user* Pages repo, not this one. App URL stays a subpath. |

**Project Pages alone (`…github.io/Timeline/`) cannot self-verify a TWA** — the
`.well-known` path resolves under `/Timeline/`, not the domain root. So pick A or B.

### If Option A (custom domain on GitHub Pages)
1. Buy the domain (registrar of choice).
2. Add a `CNAME` file to this repo containing just the domain, e.g. `yearworm.app`.
3. DNS: apex `A` records → GitHub Pages IPs (185.199.108–111.153), or a `www`
   `CNAME` → `netsrakmas.github.io`. (See GitHub's "Managing a custom domain" docs.)
4. Repo **Settings → Pages**: set the custom domain, enable **Enforce HTTPS**.
5. The committed `/.well-known/assetlinks.json` now serves at
   `https://yearworm.app/.well-known/assetlinks.json`.

---

## Step 1 — Point Pages at the deploy branch

Repo **Settings → Pages → Build and deployment → Source**: serve from the branch
you want live (currently `previews-rewrite`; switch to `main` once you promote).
Confirm the site loads over HTTPS before continuing.

---

## Step 2 — Generate the Android package

Two equivalent routes — pick one.

### Route 1: PWABuilder (easiest, GUI)
1. Go to <https://www.pwabuilder.com>, enter your live URL.
2. **Package For Stores → Android → Google Play**.
3. Set **Package ID** (e.g. `app.yearworm.twa`), app name, versions.
4. Download the zip. It contains:
   - `app-release-signed.aab` (upload this to Play)
   - `assetlinks.json` (already filled with your signing-key SHA-256)
   - a signing key (`.keystore`) — **back this up; losing it means you can't update the app**
5. Skip to **Step 3** with the provided `assetlinks.json`.

### Route 2: Bubblewrap (CLI, more control)
Run locally (needs Node + JDK; downloads Android build tools on first run):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://<your-domain>/manifest.json
# answer prompts: package id (app.yearworm.twa), app name Yearworm,
# it offers to create a signing keystore — say yes, SAVE the keystore + passwords
bubblewrap build
# outputs app-release-bundle.aab (upload) + app-release-signed.apk (sideload test)
```

Get the signing SHA-256 for asset links:
```bash
keytool -list -v -keystore android.keystore -alias android | grep SHA256
```

---

## Step 3 — Fill and publish `assetlinks.json`

`/.well-known/assetlinks.json` in this repo is a template with a placeholder
fingerprint. Replace `REPLACE_WITH_SHA256_FROM_PLAY_CONSOLE` with the real value:

- **If you use Play App Signing** (recommended, default): the correct SHA-256 is
  the one Play shows at **Play Console → Test and release → Setup → App signing →
  "App signing key certificate"**. (Google re-signs your upload, so its key — not
  your local keystore — is what devices verify.)
- **If you self-sign**: use the `keytool` SHA-256 from Step 2.

Commit the filled file, push, confirm it serves at
`https://<domain>/.well-known/assetlinks.json` (200, `application/json`).

---

## Step 4 — Play Console

1. **Create app** → name Yearworm, category **Games**, free.
2. Upload the `.aab` to an **Internal testing** track first.
3. Fill the listing: short/full description, the 512 icon, a feature graphic
   (1024×500), and **phone screenshots** (`screenshot-1/2.png` are a start;
   grab real gameplay shots from your device for a stronger listing).
4. Complete the required questionnaires (content rating, data safety, privacy
   policy URL — needed even for a simple game).
5. Roll out to Internal testing, install on your phone, verify **no address bar
   appears** (that proves asset-links verification worked).
6. Promote to Production when happy.

---

## Gotchas
- **No address bar = verification OK.** If you see a URL bar in the installed app,
  `assetlinks.json` is missing/wrong or has the wrong SHA-256.
- **Back up the signing key.** Losing it blocks all future updates.
- **iTunes previews on device** — confirm they actually play on your phone before
  shipping (this is the open real-device TODO). No previews = no game.
- **Legal posture** — previews are tolerated promotional use, not a license. Have a
  takedown contact ready (see NOTES.md).
