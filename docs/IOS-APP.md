# Crow's Nest iOS app

The app is the existing web app (`public/`) bundled into a native iOS shell with [Capacitor](https://capacitorjs.com) 8.
The pages are the same as the web version. `public/net.js` changes how they talk to the server, and only does so inside the app.
The server stays the authority: it checks every record and decides compliance. The phone stores what happened, shows the last known state and sends records when it can.

```
iPhone app (pages bundled, open with no signal)
  net.js    /api/...  ->  https://app.crows-nest.co.uk/api/v1/...  + device token
  outbox    taps, End voyage, new entries, positions: saved on the phone first, sent in order
  native    background position while a voyage is open; Preferences = durable storage
        |
Cloudflare tunnel -> Caddy (basic auth for the web; /api/v1/* let through) -> server.js (checks the token)
```

## What is built, and how sure we are

| Part | State | Confidence |
|---|---|---|
| Server: pairing codes, device tokens, `/api/v1`, CORS, crew-only phones, phone named in the audit | Built, API-tested (`tests/api-v1.js`) | High |
| Offline outbox: taps, End voyage, new entries, positions; replay applied once; refused items shown | Built, browser-tested | High |
| App behaviour (fake Capacitor bridge in Chromium): pairing, opening offline from the cache, iOS wiping web storage, background positions, print, phone removed | Built, emulation-tested (`tests/pw-app.js`) | High in emulation; **not yet run on a real iPhone** |
| The real app in the iOS 26.5 Simulator (WKWebView, Capacitor bridge, native storage) against a test server | Starts, reads its token from native storage, authenticates on `/api/v1` over CORS, loads data (CI: `iOS build check`, screenshot saved as a run artifact) | High for the Simulator; a real iPhone (location, background, real network) still to do |
| Xcode project (`app/ios`), plugins via Swift Package Manager, icon, splash, Info.plist | Compiles on Apple's toolchain in CI (`iOS build check`, BUILD SUCCEEDED with all 6 plugins) | High |
| TestFlight upload from GitHub Actions | Written, not run (needs Apple account) | Moderate |
| Background tracking on iOS | Plugin wired up | Moderate: stops if the app is swiped away. iOS can pause it. Check battery on a passage |

## This week, from the iPhone (before the Mac)

1. **Deploy the server**: run `deploy`. The web app is unchanged for you. New: Customise > Phones.
2. **Done 7 Oct 2026.** Caddy: let `/api/v1/*` through without basic auth. The app has its own login (the device token). `server.js` refuses any `/api/v1` request without a valid token, apart from pairing and `/api/v1/time`. Send Claude the last 15 lines of `grep -n "basic\|@\|handle\|route" ~/crowsnest-hor/caddy/*` to get the exact edit. It is the same kind of exemption already used for the favicon. Check afterwards:
   ```
   for p in /api/v1/time /api/v1/vessel /api/vessel; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://app.crows-nest.co.uk$p)"; done
   ```
   Expected `200`, `401`, `401`. The middle 401 comes from the app (JSON, "not paired"). The last 401 comes from Caddy (basic auth still guards the web).
3. **Enrol in the Apple Developer Program**: Apple Developer app > Account > Enroll. Costs £79 a year.
   - Individual: quickest. Your name shows as the developer, which doesn't matter for TestFlight.
   - Organisation: needs a D-U-N-S number and takes days to weeks.

   Approval can take up to 48 hours, so start now.
4. Optional: pair-code smoke test. On the web, open Customise > Phones > Pair a phone. A code appears and the phone list shows "No phones paired yet".

## At the Mac (first evening, about an hour plus downloads)

1. Install **Xcode** from the App Store (large: start the download first). Open it once, accept the licence and let it install components.
2. Install **Node 22**: from nodejs.org, or `brew install node@22`.
3. Then run:
   ```
   git clone https://github.com/pablodiablo83/crowsnest.git && cd crowsnest/app
   npm ci
   npm run sync      # copies ../public into the app and wires the plugins
   npm run doctor    # checks Xcode, Node and the server; says what to fix
   npm run open      # opens Xcode
   ```
4. In Xcode, select the **App** target > **Signing & Capabilities**:
   - Team: your developer team.
   - Bundle Identifier: `uk.co.crowsnest.app`. This becomes permanent once uploaded, so change it now if you want another.

   Xcode registers the ID itself.
5. Plug in the iPhone and trust the Mac. On the iPhone, turn on **Settings > Privacy & Security > Developer Mode** (it restarts).
6. Pick the iPhone as the run destination and press **Run**. The first build downloads the Capacitor packages (a few minutes).
7. In the app, on the Connect screen: on the web, open Customise > Phones > Pair a phone (Master). Type the code into the app.

**Real-device test (about 15 minutes):**
- The dashboard loads. Tap WORK/REST. The Hours of rest page shows the same.
- Airplane mode, then kill and reopen the app. It opens with the Offline banner and the last known status.
- Still offline: tap REST, then add a manual entry. You see "N changes saved on this phone".
- Airplane mode off and wait (or reopen the app). The changes arrive. On the web, the change history shows `quicklog-queued@<phone name>`.
- Open a voyage, allow location "Always", lock the phone for 30 minutes while moving. The track shows "phone (background)" fixes.
- Hours of rest > print opens Safari. Customise > This phone > Disconnect returns to Connect.

If something fails, send Claude the Xcode error (the first red line) or a screenshot. Don't send whole logs.

## TestFlight: keep it installed and give it to the crew

A build run from Xcode works for development. TestFlight is the proper install route (builds last 90 days, and updates arrive like App Store updates).

1. **App Store Connect > Apps > + New App**:
   - Platform: iOS.
   - Name: "Crow's Nest". Store names must be unique. If it's taken, use e.g. "Crow's Nest Hours of Rest". The home-screen name stays "Crow's Nest".
   - Bundle ID: `uk.co.crowsnest.app`.
   - SKU: `crowsnest`.
2. Upload a build, either way:
   - **From the Mac**: Xcode > Product > Archive > Distribute App > App Store Connect > Upload.
   - **From GitHub (no Mac needed afterwards)**:
     1. Create an API key: App Store Connect > Users and Access > Integrations > App Store Connect API > + (Access: **Admin**, needed for automatic signing).
     2. Download the `.p8` file (one chance only).
     3. Add 4 repository secrets in GitHub > Settings > Secrets and variables > Actions:
        - `APPLE_TEAM_ID`: developer.apple.com > Membership.
        - `ASC_KEY_ID`.
        - `ASC_ISSUER_ID`.
        - `ASC_KEY_P8`: the whole file text.
     4. Run it: Actions > **iOS TestFlight** > Run workflow. The build number is the run number.
3. Builds appear in TestFlight after processing (10 to 30 minutes).
   - **Internal testers**: up to 100, each must be a user on your App Store Connect team. Install the TestFlight app and accept the invite.
   - **Crew without accounts**: use external testing (a public link or email invites). The first build needs a light Beta App Review, about a day.
4. Each crew phone: on the web, open Customise > Phones > Pair a phone > **One crew member** > choose the person. That phone then sees and changes only that person's hours.

Not needed for TestFlight: App Store screenshots, privacy policy page, App Review. Those matter only for a public App Store listing.

## Day-to-day

- **Web pages change** (anything in `public/`): push to `main` and run `deploy` for the web.
  - The app carries its own copy of the pages, so it needs a new build: `npm run sync` then Run (Mac), or the TestFlight workflow.
  - Server API changes reach both at once: keep `/api/v1` backwards compatible, because old app builds keep running.
- **Phone lost**: open Customise > Phones > Remove. It stops working at once and its records stay.
- **Tests**: run `tests/run-all.sh` before pushing. GitHub runs it on every push ("Tests").
- **CI cost**: "iOS build check" runs on a hosted Mac, but only when `app/` changes. On a private repo, Mac minutes count 10x against the free 2,000 a month, so a build of about 10 minutes uses about 100.

## Known limits

- **Edits and deletes need a connection.** By design: replaying an edit against a record that has changed since can corrupt it. New records queue; changes to existing ones don't.
- **Print and CSV/GPX/JSON downloads** open the web version in Safari (web login). The app's web view cannot print.
- **Background tracking** stops if the app is swiped away, and iOS may slow it when battery is low. The track page shows the gaps.
- **Not done yet:** push notifications (e.g. a rest-budget warning), Android (Capacitor supports it; `npx cap add android`), and Face ID to open the app.
