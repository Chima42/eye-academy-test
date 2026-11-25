#!/bin/sh
# Start the Firebase emulators (Auth + Firestore) and the app together; Ctrl-C stops both.
# The emulators need Java 21+. Uses JAVA_HOME if set, otherwise a JDK 21+ unpacked in ~/.local/share.
set -e

# Every port is fixed (firebase.json, vite.config.ts): the app's client code and the README point at them.
# Stop with a clear message if one is taken, rather than letting a tool move to another port.
PORTS="3000:app 4000:emulator-ui 4400:emulator-hub 4500:emulator-logging 8080:firestore 9099:auth 9150:firestore-websocket"
busy=""
for entry in $PORTS; do
  port=${entry%%:*}
  pid=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$pid" ] && busy="$busy\n  $port (${entry#*:}) is in use by pid $pid: $(ps -o command= -p "$pid" | cut -c1-80)"
done
if [ -n "$busy" ]; then
  printf "Can't start: these ports are already in use:%b\nStop those processes (e.g. kill <pid>, or Ctrl-C a previous npm run dev) and try again.\n" "$busy" >&2
  exit 1
fi

if [ -z "$JAVA_HOME" ]; then
  for d in "$HOME"/.local/share/jdk-2*/Contents/Home; do [ -x "$d/bin/java" ] && export JAVA_HOME="$d"; done
fi
[ -n "$JAVA_HOME" ] && export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p .emulator-data
# Data persists between runs in .emulator-data (git-ignored).
exec npx firebase emulators:exec --only auth,firestore --ui --import ./.emulator-data --export-on-exit ./.emulator-data "npx vite dev"
