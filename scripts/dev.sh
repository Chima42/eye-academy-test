#!/bin/sh
# Start the Firebase emulators (Auth + Firestore) and the app together; Ctrl-C stops both.
# The emulators need Java 21+. Uses JAVA_HOME if set, otherwise a JDK 21+ unpacked in ~/.local/share.
set -e
if [ -z "$JAVA_HOME" ]; then
  for d in "$HOME"/.local/share/jdk-2*/Contents/Home; do [ -x "$d/bin/java" ] && export JAVA_HOME="$d"; done
fi
[ -n "$JAVA_HOME" ] && export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p .emulator-data
# Data persists between runs in .emulator-data (git-ignored).
exec npx firebase emulators:exec --only auth,firestore --ui --import ./.emulator-data --export-on-exit ./.emulator-data "npx vite dev --port 3000"
