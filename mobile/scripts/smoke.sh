#!/usr/bin/env bash
# Emulator smoke test: installs the APK, opens every screen, saves screenshots and the log.
set -u
PKG=org.thephoenixcatalyst.community
OUT=screens
mkdir -p "$OUT"
# Close slow-emulator system popups (e.g. "Pixel Launcher isn't responding") before each screenshot
shot() { sleep "$2"; adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1; sleep 1; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
open() { adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null; }

adb shell settings put global hide_error_dialogs 1 || true
adb install -r -g phoenix-community.apk
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
shot 01-explore 25
adb shell input swipe 540 1900 540 700 500; shot 02-explore-scrolled 3
adb shell input swipe 540 1900 540 500 500; shot 03-explore-calendar 3
if [ -n "${EVENT_ID:-}" ]; then open "phoenix:///event/$EVENT_ID"; shot 04-event 10; open "phoenix:///comments/$EVENT_ID"; shot 04b-comments 8; adb shell input keyevent KEYCODE_BACK; sleep 2; fi
open "phoenix:///map";     shot 05-map 15
open "phoenix:///add";     shot 06-add 6
open "phoenix:///mine";    shot 07-mine 6
open "phoenix:///about";   shot 08-about 6
adb shell input swipe 540 1900 540 600 500; shot 08b-about-volunteer 3
adb shell input swipe 540 1900 540 600 500; shot 08c-about-donate 3
open "phoenix:///apply/volunteer"; shot 08d-apply 6
open "phoenix:///sign-in"; shot 09-sign-in 6
open "phoenix:///filters"; shot 10-filters 6
open "phoenix:///scan";    shot 10b-scan 8
adb shell input keyevent KEYCODE_BACK; sleep 2
open "phoenix:///widget-preview"; shot 10c-widget 8
open "phoenix:///day/$(date +%Y-%m-%d)"; shot 10d-day 6
adb shell dumpsys appwidget 2>/dev/null | grep -iE "phoenix|PhoenixCalendar" | head -5 > "$OUT/widget.txt"; [ -s "$OUT/widget.txt" ] || echo "widget provider NOT registered" > "$OUT/widget.txt"
adb shell input keyevent KEYCODE_BACK; sleep 2
adb shell dumpsys shortcut 2>/dev/null | grep -iE "id=scan|shortcut_scan|Scan a flyer" | head -5 > "$OUT/shortcuts.txt"; [ -s "$OUT/shortcuts.txt" ] || echo "scan shortcut NOT found in dumpsys shortcut" > "$OUT/shortcuts.txt"
adb shell cmd uimode night yes
adb shell am force-stop "$PKG"; adb shell am start -W -n "$PKG/.MainActivity"
shot 11-explore-dark 20
if [ -n "${EVENT_ID:-}" ]; then open "phoenix:///event/$EVENT_ID"; shot 12-event-dark 10; fi
adb logcat -d > "$OUT/logcat.txt"
grep -E "FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)|AndroidRuntime" "$OUT/logcat.txt" | head -50 > "$OUT/errors.txt" || true
echo "errors: $(wc -l < "$OUT/errors.txt")"
[ -s "$OUT/errors.txt" ] || echo "No crashes or JavaScript errors found." > "$OUT/errors.txt"
exit 0
