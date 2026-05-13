#!/usr/bin/env bash
# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
#
# 4ham Remote Operation — server control
#
# Usage:
#   ./scripts/4ham_control.sh start
#   ./scripts/4ham_control.sh stop
#   ./scripts/4ham_control.sh restart
#   ./scripts/4ham_control.sh status
#   ./scripts/4ham_control.sh logs

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/backend.log"
PID_FILE="$LOG_DIR/backend.pid"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
SERVICE_NAME="4ham-remote"

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status|logs}

  start    Inicia o servidor em segundo plano
  stop     Para o servidor
  restart  Para e reinicia o servidor
  status   Mostra processos em execução e saúde da API
  logs     Segue o ficheiro de registo em tempo real (Ctrl+C para sair)
EOF
}

# ── helpers ───────────────────────────────────────────────────────────────────

# Detecta se o serviço systemd está instalado
has_systemd_service() {
  systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null \
    && systemctl list-unit-files "${SERVICE_NAME}.service" | grep -q "${SERVICE_NAME}"
}

collect_uvicorn_pids() {
  pgrep -f 'uvicorn backend.app.main:app' 2>/dev/null || true
}

kill_process_tree() {
  local parent_pid="$1"
  local child
  for child in $(pgrep -P "$parent_pid" 2>/dev/null || true); do
    kill_process_tree "$child"
  done
  kill -TERM "$parent_pid" >/dev/null 2>&1 || true
}

wait_for_shutdown() {
  local deadline=$((SECONDS + 8))
  while true; do
    local pids
    pids="$(collect_uvicorn_pids)"
    if [[ -z "$pids" ]]; then
      break
    fi
    if (( SECONDS >= deadline )); then
      for pid in $pids; do
        kill -KILL "$pid" >/dev/null 2>&1 || true
      done
      break
    fi
    sleep 0.2
  done
}

check_installation() {
  if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Erro: ambiente virtual Python não encontrado em $ROOT_DIR/.venv" >&2
    echo "      Execute o instalador primeiro: ./install.sh" >&2
    exit 1
  fi
}

# ── comandos (systemd) ────────────────────────────────────────────────────────

do_start_systemd()   { sudo systemctl start   "$SERVICE_NAME"; echo "Serviço $SERVICE_NAME iniciado."; }
do_stop_systemd()    { sudo systemctl stop    "$SERVICE_NAME"; echo "Serviço $SERVICE_NAME parado."; }
do_restart_systemd() { sudo systemctl restart "$SERVICE_NAME"; echo "Serviço $SERVICE_NAME reiniciado."; }

do_status_systemd() {
  systemctl status "$SERVICE_NAME" --no-pager || true
  echo
  echo "=== API health ==="
  curl -sk -m 3 https://127.0.0.1:8000/health 2>/dev/null || echo "API não responde."
}

do_logs_systemd() {
  echo "A seguir registos de $SERVICE_NAME  (Ctrl+C para sair)"
  journalctl -u "$SERVICE_NAME" -f --no-pager
}

# ── comandos (manual) ─────────────────────────────────────────────────────────

do_start_manual() {
  check_installation

  local existing_pids
  existing_pids="$(collect_uvicorn_pids)"
  if [[ -n "$existing_pids" ]]; then
    echo "O servidor já está em execução (PID: $(echo "$existing_pids" | tr '\n' ' '))"
    exit 0
  fi

  mkdir -p "$LOG_DIR"

  cd "$ROOT_DIR"
  export REMOTE_CONFIG="$ROOT_DIR/config/remote_config.yaml"
  nohup "$PYTHON_BIN" -m uvicorn backend.app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --ssl-certfile "$ROOT_DIR/certs/cert.pem" \
    --ssl-keyfile  "$ROOT_DIR/certs/key.pem" \
    >> "$LOG_FILE" 2>&1 &
  local pid="$!"
  echo "$pid" > "$PID_FILE"
  echo "Servidor iniciado (PID: $pid)"
  echo "Log : $LOG_FILE"
  echo "URL : https://127.0.0.1:8000/"
}

do_stop_manual() {
  check_installation

  local pids
  pids="$(collect_uvicorn_pids)"
  if [[ -z "$pids" ]]; then
    echo "O servidor não está em execução."
    rm -f "$PID_FILE"
    return 0
  fi

  echo "A parar o servidor (PID: $(echo "$pids" | tr '\n' ' '))..."
  for pid in $pids; do
    kill_process_tree "$pid"
  done
  wait_for_shutdown
  rm -f "$PID_FILE"
  echo "Servidor parado."
}

do_restart_manual() {
  do_stop_manual
  sleep 0.5
  do_start_manual
}

do_status_manual() {
  echo "=== Processos do servidor ==="
  local pids
  pids="$(pgrep -af 'uvicorn backend.app.main:app' 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids"
  else
    echo "Nenhum processo encontrado."
  fi

  echo
  echo "=== Porta 8000 ==="
  ss -ltnp 2>/dev/null | grep ':8000' || echo "Porta 8000 não está a escutar."

  echo
  echo "=== API health ==="
  curl -sk -m 3 https://127.0.0.1:8000/health 2>/dev/null || echo "API não responde."

  echo
  echo "=== Últimas 20 linhas do log ==="
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 20 "$LOG_FILE"
  else
    echo "Sem ficheiro de log em $LOG_FILE"
  fi
}

do_logs_manual() {
  mkdir -p "$LOG_DIR"
  touch "$LOG_FILE"
  echo "A seguir $LOG_FILE  (Ctrl+C para sair)"
  tail -f "$LOG_FILE"
}

# ── dispatch ──────────────────────────────────────────────────────────────────

command="${1:-}"

if has_systemd_service; then
  case "$command" in
    start)    do_start_systemd ;;
    stop)     do_stop_systemd ;;
    restart)  do_restart_systemd ;;
    status)   do_status_systemd ;;
    logs)     do_logs_systemd ;;
    ""|help|-h|--help) usage ;;
    *) echo "Erro: comando desconhecido '${command}'" >&2; usage; exit 1 ;;
  esac
else
  case "$command" in
    start)    do_start_manual ;;
    stop)     do_stop_manual ;;
    restart)  do_restart_manual ;;
    status)   do_status_manual ;;
    logs)     do_logs_manual ;;
    ""|help|-h|--help) usage ;;
    *) echo "Erro: comando desconhecido '${command}'" >&2; usage; exit 1 ;;
  esac
fi
