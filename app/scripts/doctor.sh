#!/usr/bin/env bash
# Check this Mac is ready to build the Crow's Nest app: npm run doctor   (prints one line per check)
ok() { echo "ok    $1"; }; bad() { echo "FIX   $1"; fail=1; }; fail=0
[ "$(uname)" = Darwin ] && ok "macOS $(sw_vers -productVersion)" || bad "this is not a Mac (iOS apps build only on macOS)"
if xcodebuild -version >/dev/null 2>&1; then ok "$(xcodebuild -version | head -1)"; else bad "Xcode: install it from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app"; fi
xcode-select -p 2>/dev/null | grep -q Xcode.app && ok "xcode-select points at Xcode" || bad "run: sudo xcode-select -s /Applications/Xcode.app"
v=$(node -v 2>/dev/null | sed 's/v//; s/\..*//'); [ -n "$v" ] && [ "$v" -ge 20 ] && ok "node $(node -v)" || bad "Node 20+ needed: brew install node@22 (or nodejs.org)"
[ -d node_modules/@capacitor/ios ] && ok "npm packages installed" || bad "run: npm ci   (in the app folder)"
[ -f www/index.html ] && ok "web pages copied (www/)" || bad "run: npm run sync"
curl -s -o /dev/null -w '%{http_code}' https://app.crows-nest.co.uk/api/v1/time | grep -q 200 && ok "server reachable for the app (/api/v1/time)" \
  || bad "https://app.crows-nest.co.uk/api/v1/time is not 200: deploy the server, and let /api/v1/* through Caddy (docs/IOS-APP.md)"
# Android (optional on this computer: GitHub builds Android without it). Only reported, never a failure.
if java -version >/dev/null 2>&1; then echo "ok    Android: $(java -version 2>&1 | head -1)"; else echo "info  Android: no Java here (only needed to build Android locally: Android Studio includes it)"; fi
[ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ] && echo "ok    Android SDK: ${ANDROID_HOME:-$ANDROID_SDK_ROOT}" || echo "info  Android SDK not set up here (Android Studio installs it; GitHub builds Android without it)"
[ $fail = 0 ] && echo "Ready: npm run open, then Run in Xcode (Android: npm run open:android in Android Studio)." || echo "Fix the lines marked FIX, then run npm run doctor again."
exit $fail
