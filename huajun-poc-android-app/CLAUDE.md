# Notes for Claude Code

This directory is an intentionally git-ignored Capacitor Android PoC for the parent library. Keep it out of the
library (no docs/deps/changes there for its sake). Building the APK IS possible in this devcontainer
(Node, JDK 21, Android SDK 36 preinstalled; no host toolchain needed). See README.md for details.

Build:
1. `(cd .. && npm install && npm run build)`  (library is linked via `file:..`; rebuild after library changes)
2. `npm install`
3. First time only: `npm run setup:android` (cap add android + BLE manifest patch + sync). `android/` already exists here.
4. `npm run apk` -> `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed). First Gradle build is slow.

Typecheck only: `npm run build` (tsc + vite). Can't test BLE here; the user sideloads the APK on a phone (README covers copying or adb).
