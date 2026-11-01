// Adds a "Scan a flyer" shortcut: long-press the app icon (or drag it to the home screen)
// to open the live scanner in one tap. Opens phoenix:///scan.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withStringsXml } = require('expo/config-plugins');

const XML = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="scan" android:enabled="true" android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/shortcut_scan_short" android:shortcutLongLabel="@string/shortcut_scan_long">
    <intent android:action="android.intent.action.VIEW" android:data="phoenix:///scan"
      android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity" />
  </shortcut>
</shortcuts>
`;

module.exports = function withScanShortcut(config) {
  const pkg = config.android?.package;
  if (!pkg) throw new Error('with-scan-shortcut needs android.package');
  config = withStringsXml(config, (c) => {
    for (const [name, value] of [['shortcut_scan_short', 'Scan a flyer'], ['shortcut_scan_long', 'Scan an event flyer']]) {
      c.modResults = AndroidConfig.Strings.setStringItem([{ $: { name }, _: value }], c.modResults);
    }
    return c;
  });
  config = withDangerousMod(config, ['android', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'shortcuts.xml'), XML(pkg));
    return c;
  }]);
  return withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    activity['meta-data'] = (activity['meta-data'] || []).filter((m) => m.$['android:name'] !== 'android.app.shortcuts');
    activity['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } });
    return c;
  });
};
