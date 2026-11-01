#!/usr/bin/env bash
# Emulator smoke test: installs the APK, opens every screen, saves screenshots and the log.
set -u
PKG=org.thephoenixcatalyst.community
OUT=screens
mkdir -p "$OUT"
shot() { sleep "$2"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
open() { adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null; }

adb install -r -g phoenix-community.apk
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
shot 01-explore 25
adb shell input swipe 540 1900 540 700 500; shot 02-explore-scrolled 3
adb shell input swipe 540 1900 540 500 500; shot 03-explore-calendar 3
if [ -n "${EVENT_ID:-}" ]; then open "phoenix:///event/$EVENT_ID"; shot 04-event 10; fi
open "phoenix:///map";     shot 05-map 15
open "phoenix:///add";     shot 06-add 6
open "phoenix:///mine";    shot 07-mine 6
open "phoenix:///about";   shot 08-about 6
open "phoenix:///sign-in"; shot 09-sign-in 6
open "phoenix:///filters"; shot 10-filters 6
adb shell cmd uimode night yes
adb shell am force-stop "$PKG"; adb shell am start -W -n "$PKG/.MainActivity"
shot 11-explore-dark 20
if [ -n "${EVENT_ID:-}" ]; then open "phoenix:///event/$EVENT_ID"; shot 12-event-dark 10; fi
adb logcat -d > "$OUT/logcat.txt"
grep -E "FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)|AndroidRuntime" "$OUT/logcat.txt" | head -50 > "$OUT/errors.txt" || true
echo "errors: $(wc -l < "$OUT/errors.txt")"
exit 0
