#!/bin/sh
# Privacy check against the running app (npm run dev): two users; B must not read or write A's attempts,
# and the API routes refuse requests without a valid ID token.
A='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key'
APP=${APP_URL:-http://localhost:3000}
F='http://127.0.0.1:8080/v1/projects/demo-eye-viva/databases/(default)/documents'
tok() { curl -s -X POST "$A" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"secret123\",\"returnSecureToken\":true}" |
  python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["idToken"],d["localId"])'; }
set -- $(tok "alice-$$@test.dev"); TA=$1; UA=$2
set -- $(tok "bob-$$@test.dev"); TB=$1
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { [ "$2" = "$3" ] && r=PASS || r=FAIL; echo "$r  $1: expected $3, got $2"; }
check "A writes own attempt" "$(code -X PATCH "$F/users/$UA/attempts/t1" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"fields":{"stage":{"stringValue":"findings"}}}')" 200
check "A reads own attempt " "$(code "$F/users/$UA/attempts/t1" -H "Authorization: Bearer $TA")" 200
check "B reads A's attempt " "$(code "$F/users/$UA/attempts/t1" -H "Authorization: Bearer $TB")" 403
check "B lists A's attempts" "$(code "$F/users/$UA/attempts" -H "Authorization: Bearer $TB")" 403
check "B writes into A's   " "$(code -X PATCH "$F/users/$UA/attempts/x" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"fields":{"stage":{"stringValue":"x"}}}')" 403
check "Signed out reads A's" "$(code "$F/users/$UA/attempts/t1")" 403
check "Signed out transcribe" "$(code -X POST "$APP/api/transcribe")" 401
check "Forged token speak   " "$(code -X POST "$APP/api/speak" -H 'Authorization: Bearer forged' -H 'Content-Type: application/json' -d '{"text":"x"}')" 401
check "Signed in transcribe " "$(code -X POST "$APP/api/transcribe" -H "Authorization: Bearer $TA")" 200
