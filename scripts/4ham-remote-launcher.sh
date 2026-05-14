#!/usr/bin/env bash
# 4ham Remote Operation — Desktop Launcher
# © 2026 Octávio Filipe Gonçalves — CT7BFV
#
# Called by the desktop shortcut. Shows a whiptail menu for
# Start / Stop / Restart / Status / Logs / Browser / Exit.
#
# Language: reads config/.installer_lang (written by install.sh).
# To add a language: add locales/XX.sh and re-run the installer.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="4ham-remote"

# ── i18n ──────────────────────────────────────────────────────────────────────
_lang_file="$ROOT_DIR/config/.installer_lang"
_lang="en"
[[ -f "$_lang_file" ]] && _lang="$(tr -d '[:space:]' < "$_lang_file")"
_locale_sh="$ROOT_DIR/locales/${_lang}.sh"
[[ -f "$_locale_sh" ]] || _locale_sh="$ROOT_DIR/locales/en.sh"
# shellcheck disable=SC1090
source "$_locale_sh"

# ── helpers ───────────────────────────────────────────────────────────────────
run_sudo() { [[ "${EUID}" -eq 0 ]] && "$@" || sudo "$@"; }

_has_systemd() {
  systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null 2>&1
}

_service_active() {
  systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null
}

# ── main menu loop ─────────────────────────────────────────────────────────────
while true; do
  _choice=$(whiptail \
    --backtitle "$I18N_BT_LAUNCHER" \
    --title     "$I18N_TITLE_LAUNCHER" \
    --menu      "$I18N_MSG_LAUNCHER" \
    18 62 7 \
    "start"   "$I18N_OPT_L_START" \
    "stop"    "$I18N_OPT_L_STOP" \
    "restart" "$I18N_OPT_L_RESTART" \
    "status"  "$I18N_OPT_L_STATUS" \
    "logs"    "$I18N_OPT_L_LOGS" \
    "browser" "$I18N_OPT_L_BROWSER" \
    "exit"    "$I18N_OPT_L_EXIT" \
    3>&1 1>&2 2>&3) || break

  case "$_choice" in
    start)
      if _has_systemd; then
        run_sudo systemctl start "${SERVICE_NAME}" && true
      else
        bash "$ROOT_DIR/scripts/4ham_control.sh" start
      fi
      ;;
    stop)
      if _has_systemd; then
        run_sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
      else
        pkill -f "uvicorn backend.app.main" 2>/dev/null || true
      fi
      ;;
    restart)
      if _has_systemd; then
        run_sudo systemctl restart "${SERVICE_NAME}" 2>/dev/null || true
      else
        pkill -f "uvicorn backend.app.main" 2>/dev/null || true
        sleep 1
        bash "$ROOT_DIR/scripts/4ham_control.sh" start
      fi
      ;;
    status)
      if _has_systemd; then
        systemctl status "${SERVICE_NAME}" --no-pager 2>/dev/null || true
      else
        if pgrep -f "uvicorn backend.app.main" &>/dev/null; then
          echo "Running (manual mode)"
        else
          echo "Stopped"
        fi
      fi
      read -rp "" _dummy || true
      ;;
    logs)
      if _has_systemd; then
        journalctl -u "${SERVICE_NAME}" -f --no-pager 2>/dev/null || true
      else
        _logfile="$(ls -t /tmp/4ham-remote-*.log 2>/dev/null | head -n1 || true)"
        [[ -n "$_logfile" ]] && tail -f "$_logfile" || echo "No log file found."
        read -rp "" _dummy || true
      fi
      ;;
    browser)
      _ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
      xdg-open "https://${_ip}:8001/" 2>/dev/null || true
      ;;
    exit|"")
      break
      ;;
  esac
done
