#!/usr/bin/env bash
# Start, stop or restart the API in the background for local QA.
#
#   server/scripts/dev-api.sh start|stop|restart
#
# Reads the repo-root .env, logs to /tmp/sunmill-api.log, and waits for
# /api/health before reporting success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE=/tmp/sunmill-api.pid

stop() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    pkill -P "$(cat "$PIDFILE")" 2>/dev/null || true
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    sleep 1
    kill -9 "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
}

start() {
  set -a; . "$ROOT/.env"; set +a
  cd "$ROOT/server"
  setsid node "$ROOT/node_modules/.bin/tsx" src/index.ts > /tmp/sunmill-api.log 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 30); do
    sleep 1
    # A health check alone is not proof: an older instance may still hold the
    # port. Only report success when OUR process is the one that is alive.
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "sunmill-api exited during startup; see /tmp/sunmill-api.log" >&2
      tail -20 /tmp/sunmill-api.log >&2
      return 1
    fi
    if curl -sf -o /dev/null "http://127.0.0.1:${API_PORT:-4000}/api/health"; then
      echo "sunmill-api up on :${API_PORT:-4000} (pid $(cat "$PIDFILE"))"
      return 0
    fi
  done
  echo "sunmill-api failed to start; see /tmp/sunmill-api.log" >&2
  tail -20 /tmp/sunmill-api.log >&2
  return 1
}

case "${1:-restart}" in
  start) start ;;
  stop) stop; echo "stopped" ;;
  restart) stop; start ;;
  *) echo "usage: $0 start|stop|restart" >&2; exit 2 ;;
esac
