#!/usr/bin/env bash
# Android Emulator smoke test (run by .github/workflows/android-build.yml inside the emulator runner).
set -u
APK=app/android/app/build/outputs/apk/debug/app-debug.apk
PKG=uk.co.crowsnest.app
SHOTS="$RUNNER_TEMP/shots"; mkdir -p "$SHOTS"
adb wait-for-device
adb reverse tcp:8091 tcp:8091                     # the emulator's 127.0.0.1:8091 is this runner's test server
adb install -r "$APK" && echo installed
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $PKG android.permission.$p 2>/dev/null || true; done
adb shell am start -W -n $PKG/.MainActivity && echo launched
ok=0
for i in $(seq 40); do
  sleep 3
  if curl -sf -b "$RUNNER_TEMP/cookies" localhost:8091/api/devices | grep -q '"lastSeen":"'; then ok=1; break; fi
done
sleep 8
adb exec-out screencap -p > "$SHOTS/emulator-dashboard.png"; echo screenshot
# Back on the first page should leave the app (net.js backButton handler -> App.exitApp)
adb shell input keyevent KEYCODE_BACK; sleep 3
adb shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" || true
adb exec-out screencap -p > "$SHOTS/emulator-after-back.png"
adb logcat -d -s Capacitor:* chromium:* 2>/dev/null | tail -40 > "$SHOTS/logcat.txt" || true
if [ $ok = 1 ]; then echo "The app authenticated with its device token and loaded data."; else echo "The app never reached the server"; tail -20 "$RUNNER_TEMP/server.log"; tail -40 "$SHOTS/logcat.txt"; exit 1; fi
