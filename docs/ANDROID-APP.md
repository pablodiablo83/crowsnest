# Crow's Nest Android app

The same app as iOS: one Capacitor project (`app/`) bundling the same pages (`public/`) into both shells.
`app/ios` is the iOS project, `app/android` the Android one. Same app ID (`uk.co.crowsnest.app`), name, icon,
version, plugins, offline outbox, pairing and server. Change a page once and both apps get it at their next build.

## What is built, and how sure we are

| Part | State | Confidence |
|---|---|---|
| Android project (`app/android`): permissions (location, foreground service for the voyage track, notifications), HTTPS-only (plain HTTP only for a local test server), no cloud backup of the device token, adaptive icon + splash from `app/assets` | Generated from Capacitor 8, configured | High |
| Back button / gesture: closes an open form, else previous page, else leaves the app; content kept clear of the status and navigation bars | `public/net.js`, emulation-tested (`tests/pw-app.js`) | High in emulation |
| Compile + run in the Android Emulator against a test server, screenshot (GitHub: **Android build check**) | Every push that touches the app | See the latest run |
| Signed release bundle + upload to Google Play (GitHub: **Android release**) | Written; needs your Google Play account and an upload key | Moderate until first run |
| Background tracking | Same plugin as iOS; on Android it runs as a foreground service with a notification ("Recording the voyage track") | Moderate: battery savers on some phones (Samsung, Xiaomi) can stop it; the track page shows gaps |

## Try it on an Android phone now (no Google account)

Actions > **Android build check** > latest run > Artifacts > `crowsnest-android-debug-apk`. On the phone: open the
`.apk`, allow "install unknown apps" for the browser/Files when asked, install, then pair it as on iPhone
(web: Customise > Phones > Pair a phone). Debug builds are for testing only: crew should get the Play Store build.

## Google Play: one-time setup

1. **Developer account**: play.google.com/console, one-off US$25. Identity verification takes a few days.
   - Personal accounts made since Nov 2023 must run a **closed test with at least 12 testers for 14 days** before
     the app can go to production. **Internal testing** (up to 100 testers you invite) has no such wait: that is the
     TestFlight equivalent and all we need for the boat. (Google's rule as I understand it; check the Console.)
2. **Create the app**: Console > Create app > name "Crow's Nest", app, free. The package name is fixed by the first
   upload (`uk.co.crowsnest.app`).
3. **Upload key** (signs what we upload; Google re-signs for phones with its own key, "Play App Signing"). Make it on
   the server with Docker (no Java needed there), keep it safe, and put it into GitHub with the GitHub CLI so nothing
   long is copied by hand:
   ```
   mkdir -p ~/cn-android && cd ~/cn-android
   docker run --rm -it -v "$PWD":/k eclipse-temurin:21-jre keytool -genkeypair -storetype PKCS12 \
     -keystore /k/upload.p12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Crow's Nest, C=GB"
   sudo apt install -y gh && gh auth login        # once; choose GitHub.com, HTTPS, login with a browser code
   base64 -w0 upload.p12 | gh secret set ANDROID_KEYSTORE_B64 -R pablodiablo83/crowsnest
   gh secret set ANDROID_KEY_ALIAS -R pablodiablo83/crowsnest -b upload
   gh secret set ANDROID_KEYSTORE_PASSWORD -R pablodiablo83/crowsnest   # type the password you chose
   ```
   Back up `~/cn-android/upload.p12` and its password somewhere off the server (a lost upload key can be reset
   through Google Play support, but it takes days).
4. **First release, by hand**: Actions > **Android release** > Run workflow (track internal). With no Play key yet it
   keeps the signed bundle: run > Artifacts > `crowsnest-android-release-aab`. Console > Testing > Internal testing >
   Create release > upload the `.aab` > Save > Review > Roll out.
5. **Automatic uploads after that** (optional, like TestFlight from GitHub):
   - Google Cloud console: a project, enable **Google Play Android Developer API**, create a service account, add a
     JSON key.
   - Play Console > Users and permissions > Invite the service account's email; permission: Release apps to testing
     tracks (and production if wanted).
   - GitHub secret `PLAY_SERVICE_ACCOUNT_JSON` = the whole JSON file (`gh secret set PLAY_SERVICE_ACCOUNT_JSON < key.json`).
   - From then on: Actions > Android release > Run workflow uploads straight to the track you pick.
6. **Testers**: Console > Internal testing > Testers: a list of Google account emails. They open the opt-in link
   and install from the Play Store; updates arrive like any app.
7. **App content** (Console > Policy > App content), needed before wider testing or production:
   privacy policy URL, Data safety form (location, crew names and hours stored on your own server), and the
   **foreground service (location)** declaration for the voyage track (a short video of the track recording may be
   asked for). Internal testing works before these are complete.

## Day-to-day (both platforms)

- Pages change (`public/`): push, `deploy` for the web; the apps need a new build:
  - iOS: Actions > **iOS TestFlight** > Run workflow (or `npm run sync:ios` + Run in Xcode).
  - Android: Actions > **Android release** > Run workflow (or the debug APK from **Android build check**).
- Version: `app/package.json` "version" is the version name on both (e.g. 1.0.0); each workflow's run number is the
  build number. Bump the version for a release you want to tell apart.
- Icons: `cd app && npm run icons` makes iOS and Android icons and splash screens from `app/assets/icon.svg`.
- `npm run sync` copies the pages into both apps; `npm run open:android` opens Android Studio (if installed).

## Known limits (Android)

- Same as iOS: edits and deletes need a connection; printing and downloads open the web version in the browser.
- Some manufacturers' battery savers stop background tracking; if the track has gaps, set Crow's Nest to
  "Unrestricted" battery use on that phone.
- The emulator test proves the app starts, signs in with its device token and loads data; a real phone is still the
  final check for GPS and background tracking.
