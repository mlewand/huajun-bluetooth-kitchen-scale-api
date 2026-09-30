# huajun-poc-android-app

Minimal Capacitor app that shows the live reading from a HUAJUN (NSCALE) BLE kitchen scale, using
`@mlewand/huajun-ble-scale`. Proof of concept.

## Prerequisites

Node >= 22, JDK 21 and the Android SDK (platform 36). The repo's devcontainer provides all of these, so no
Android Studio or host toolchain is needed. Outside the devcontainer, install them yourself and set `ANDROID_HOME`.

## Build the APK

The library is not published yet; it is linked from the parent directory (`file:..`) and must be built first:

```
(cd .. && npm install && npm run build)
npm install
npm run setup:android     # once: build web app, cap add android, add BLE permissions, cap sync
npm run apk               # build web app, cap sync, gradle assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed, fine for sideloading).

Install it on the phone by copying the file over (allow "install unknown apps" for the app you open it with),
or with `adb install -r app-debug.apk` from a machine that has adb. Then tap **Connect to NSCALE**, accept the
Bluetooth permission prompt and pick the scale.

After changing the app code, run `npm run apk` again. After changing the library, run `npm run build` in the
parent first. The first Gradle build downloads a lot (Gradle, AGP, AndroidX); the devcontainer keeps
`~/.gradle` in a named volume so later builds are fast.

`npm run dev` serves the same page for desktop Chrome (Web Bluetooth).

## Notes

- `vite.config.ts` dedupes `@capacitor/core` and the BLE plugin. Without it the linked library would load a
  second copy of Capacitor from the parent's `node_modules`.
- This directory is git-ignored by the parent repo. Move it out or `git init` it here.

## Device picker

On Android the picker is filtered to devices advertising the name `NSCALE` (`CapacitorTransport` `name` option).
If the scale doesn't show up, use the **Show all devices** button (the name may only be in the scan response).
Desktop Chrome always lists all devices because its name filter doesn't match this scale.
