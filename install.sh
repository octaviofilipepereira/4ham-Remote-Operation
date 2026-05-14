#!/usr/bin/env bash
# © 2026 Octávio Filipe Gonçalves — CT7BFV
# License: GNU GPL-3.0
#
# 4ham Remote Operation — Graphical Installer (whiptail TUI)
#
# Suportado: Ubuntu 20.04+, Debian 11+, Linux Mint 20+, Raspberry Pi OS (Bullseye+)
#
# Uso:
#   chmod +x install.sh
#   ./install.sh
#
# ── i18n ──────────────────────────────────────────────────────────────────────
# Idiomas incluídos: en (English), pt (Português)
# Para adicionar um idioma: cp locales/en.sh locales/XX.sh e traduzir.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"
LOG_FILE="/tmp/4ham-remote-install-$(date +%Y%m%d-%H%M%S).log"
SERVICE_NAME="4ham-remote"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
INSTALL_LANG="en"
UI_LANG="en"
BT="4ham Remote Operation — Installer"

FIFO=""
GAUGE_PID=""
declare -a _TMPFILES=()

# ── helpers ────────────────────────────────────────────────────────────────────
run_sudo() { [[ "${EUID}" -eq 0 ]] && "$@" || sudo "$@"; }

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# i18n string formatter — substitui %KEY% pelos valores fornecidos
# Uso: i18n_fmt "$I18N_MSG_FOO"  KEY1 val1  KEY2 val2 ...
i18n_fmt() {
  local str="$1"; shift
  while [[ $# -ge 2 ]]; do
    str="${str//%$1%/$2}"
    shift 2
  done
  printf '%s' "$str"
}

# ── cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
  exec 3>&- 2>/dev/null || true
  [[ -n "${GAUGE_PID:-}" ]] && kill "${GAUGE_PID}" 2>/dev/null || true
  [[ -n "${FIFO:-}"      ]] && rm -f "${FIFO}"    2>/dev/null || true
  for _f in "${_TMPFILES[@]:-}"; do rm -f "$_f" 2>/dev/null || true; done
}
trap cleanup EXIT

# ── gauge ──────────────────────────────────────────────────────────────────────
start_gauge() {
  FIFO="$(mktemp -u /tmp/4ham-gauge-XXXXXX)"
  mkfifo "$FIFO"
  whiptail --backtitle "$BT" --gauge "$1" 8 72 0 < "$FIFO" &
  GAUGE_PID=$!
  exec 3>"$FIFO"
}

gauge_step() {
  printf 'XXX\n%d\n%s\n\nLog: %s\nXXX\n' "$1" "$2" "$LOG_FILE" >&3 2>/dev/null || true
}

close_gauge() {
  printf 'XXX\n100\n...\nXXX\n' >&3 2>/dev/null || true
  exec 3>&- 2>/dev/null || true
  wait "${GAUGE_PID}" 2>/dev/null || true
  rm -f "${FIFO}"; FIFO=""; GAUGE_PID=""
}

abort() {
  exec 3>&- 2>/dev/null || true
  [[ -n "${GAUGE_PID:-}" ]] && {
    kill "${GAUGE_PID}" 2>/dev/null || true
    wait "${GAUGE_PID}" 2>/dev/null || true
    GAUGE_PID=""
  }
  [[ -n "${FIFO:-}" ]] && { rm -f "${FIFO}"; FIFO=""; }
  whiptail --backtitle "$BT" --title "$I18N_TITLE_ABORT" \
    --msgbox "$(i18n_fmt "$I18N_MSG_ABORT" DETAIL "$1" LOG "$LOG_FILE")" 13 70
  exit 1
}

# ── OS detection ───────────────────────────────────────────────────────────────
OS_ID=""; OS_VERSION_ID=""; OS_PRETTY_NAME=""
detect_os() {
  [[ -f /etc/os-release ]] || return 1
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-unknown}"; OS_VERSION_ID="${VERSION_ID:-0}"; OS_PRETTY_NAME="${PRETTY_NAME:-$OS_ID}"
  local id="${OS_ID,,}"
  case "$id" in
    ubuntu)    version_ge "$OS_VERSION_ID" "20.04" ;;
    debian)    version_ge "$OS_VERSION_ID" "11"    ;;
    linuxmint) version_ge "$OS_VERSION_ID" "20"    ;;
    raspbian)  version_ge "$OS_VERSION_ID" "11"    ;;
    *)         return 1 ;;
  esac
}

# ── load locale ────────────────────────────────────────────────────────────────
load_locale() {
  local lang="$1"
  local locale_sh="$ROOT_DIR/locales/${lang}.sh"
  [[ -f "$locale_sh" ]] || locale_sh="$ROOT_DIR/locales/en.sh"
  # shellcheck disable=SC1090
  source "$locale_sh"
  BT="$I18N_BT"
}

# ── list available locales ─────────────────────────────────────────────────────
list_locales() {
  for _f in "$ROOT_DIR/locales/"*.sh; do
    [[ -f "$_f" ]] || continue
    local _code _name
    _code=$(bash -c "source \"$_f\" 2>/dev/null && printf '%s' \"\$LANG_CODE\"" 2>/dev/null || true)
    _name=$(bash -c "source \"$_f\" 2>/dev/null && printf '%s' \"\$LANG_NATIVE_NAME\"" 2>/dev/null || true)
    [[ -n "$_code" && -n "$_name" ]] && printf '%s\n%s\n' "$_code" "$_name"
  done
}

# ── PRE-CHECKS (before language selection) ────────────────────────────────────
if [[ "${EUID}" -eq 0 ]]; then
  echo "Do not run as root / Nao correr como root." >&2
  echo "Use: ./install.sh" >&2
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  echo "This installer requires apt (Ubuntu / Debian / Mint / Raspberry Pi OS)." >&2
  exit 1
fi

if ! command -v whiptail &>/dev/null; then
  echo "Installing whiptail..."
  run_sudo apt-get update -qq
  run_sudo apt-get install -y whiptail
fi

# ── LANGUAGE SELECTION ─────────────────────────────────────────────────────────
_locale_menu=()
while IFS= read -r _item; do
  _locale_menu+=("$_item")
done < <(list_locales)
[[ ${#_locale_menu[@]} -eq 0 ]] && _locale_menu=("en" "English" "pt" "Português")

INSTALL_LANG=$(whiptail \
  --title "Language / Idioma" \
  --menu "Select installation language / Seleccione o idioma de instalação:" \
  12 62 "${#_locale_menu[@]}" \
  "${_locale_menu[@]}" \
  3>&1 1>&2 2>&3) || exit 0

load_locale "$INSTALL_LANG"
mkdir -p "$ROOT_DIR/config"
printf '%s' "$INSTALL_LANG" > "$ROOT_DIR/config/.installer_lang"

# ── OS CHECK ───────────────────────────────────────────────────────────────────
if ! detect_os; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_OS_UNSUPPORTED" \
    --msgbox "$(i18n_fmt "$I18N_MSG_OS_UNSUPPORTED" \
      OS "${OS_PRETTY_NAME:-unknown}" VER "${OS_VERSION_ID:-?}")" \
    14 62
  exit 1
fi

# ── PYTHON CHECK ───────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_PYTHON_MISSING" \
    --msgbox "$I18N_MSG_PYTHON_MISSING" 8 58
  exit 1
fi

_pyver=$(python3 --version 2>&1)
_pyok=$(python3 -c "import sys; print('ok' if sys.version_info>=(3,11) else 'old')" 2>/dev/null || echo old)
if [[ "$_pyok" != "ok" ]]; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_PYTHON_VERSION" \
    --msgbox "$(i18n_fmt "$I18N_MSG_PYTHON_VERSION" VER "$_pyver")" 8 58
  exit 1
fi

# ── WELCOME ────────────────────────────────────────────────────────────────────
whiptail --backtitle "$BT" --title "$I18N_TITLE_WELCOME" \
  --msgbox "$(i18n_fmt "$I18N_MSG_WELCOME" OS "$OS_PRETTY_NAME")" \
  22 68

# ── UI LANGUAGE ────────────────────────────────────────────────────────────────
_ui_menu=()
while IFS= read -r _item; do
  _ui_menu+=("$_item")
done < <(list_locales)
[[ ${#_ui_menu[@]} -eq 0 ]] && _ui_menu=("en" "English" "pt" "Português")

UI_LANG=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_UI_LANG" \
  --default-item "$INSTALL_LANG" \
  --menu "$I18N_MSG_UI_LANG" \
  12 62 "${#_ui_menu[@]}" \
  "${_ui_menu[@]}" \
  3>&1 1>&2 2>&3) || exit 0

# ── RADIO PROFILE ──────────────────────────────────────────────────────────────
_radio_profile=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_RADIO" \
  --menu "$I18N_MSG_RADIO" \
  14 68 2 \
  "ft991a" "$I18N_OPT_FT991A" \
  "x6100"  "$I18N_OPT_X6100" \
  3>&1 1>&2 2>&3) || exit 0

_radio_label="$I18N_LABEL_FT991A"
[[ "$_radio_profile" == "x6100" ]] && _radio_label="$I18N_LABEL_X6100"

# ── RTL-SDR (apenas para rádios sem espectro RF nativo) ──────────────────────────────
# Rádios sem espectro RF nativo: ft991a (e futuras variáncias AF-only)
# Rádios com espectro nativo (saltar pergunta): x6100 (scope nativo)
_use_rtlsdr=0
_use_rtlsdr_v4=0
_rtlsdr_label="$I18N_LABEL_RTLSDR_NO"
_spectrum_source="audio_fft"

case "$_radio_profile" in
  ft991a)
    if whiptail --backtitle "$BT" --title "$I18N_TITLE_RTLSDR_ASK" \
      --yesno "$(i18n_fmt "$I18N_MSG_RTLSDR_ASK" RADIO "$_radio_label")" \
      18 72; then
      _use_rtlsdr=1
      _rtlsdr_label="$I18N_LABEL_RTLSDR_YES"
      _spectrum_source="rtlsdr"

      # Perguntar se é RTL-SDR Blog v4
      if whiptail --backtitle "$BT" --title "$I18N_TITLE_RTLSDR_V4" \
        --yesno "$I18N_MSG_RTLSDR_V4" 13 70; then
        _use_rtlsdr_v4=1
      fi
    fi
    ;;
  # x6100 e futuros rádios com espectro nativo: não perguntar
esac

# ── X6100 IP ───────────────────────────────────────────────────────────────────
_x6100_ip="192.168.1.100"
if [[ "$_radio_profile" == "x6100" ]]; then
  _x6100_ip=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_X6100_IP" \
    --inputbox "$I18N_MSG_X6100_IP" \
    9 60 "192.168.1.100" 3>&1 1>&2 2>&3) || exit 0
fi

# ── WSJT-X ─────────────────────────────────────────────────────────────────────
_install_wsjtx=0
_wsjtx_present=0
_wsjtx_label="$I18N_LABEL_WSJTX_NO"
_jt9_found=0; _wsprd_found=0
command -v jt9   &>/dev/null && _jt9_found=1
command -v wsprd &>/dev/null && _wsprd_found=1

if [[ $_jt9_found -eq 1 && $_wsprd_found -eq 1 ]]; then
  _wsjtx_present=1
  _wsjtx_label="$I18N_LABEL_WSJTX_FOUND"
  whiptail --backtitle "$BT" --title "$I18N_TITLE_WSJTX_FOUND" \
    --msgbox "$I18N_MSG_WSJTX_FOUND" 9 62
elif [[ $_jt9_found -eq 1 && $_wsprd_found -eq 0 ]]; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_WSJTX_PARTIAL" \
    --msgbox "$I18N_MSG_WSJTX_PARTIAL_JT9" 9 62
  _install_wsjtx=1; _wsjtx_label="$I18N_LABEL_WSJTX_FIX"
elif [[ $_jt9_found -eq 0 && $_wsprd_found -eq 1 ]]; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_WSJTX_PARTIAL" \
    --msgbox "$I18N_MSG_WSJTX_PARTIAL_WSPRD" 9 62
  _install_wsjtx=1; _wsjtx_label="$I18N_LABEL_WSJTX_FIX"
else
  if whiptail --backtitle "$BT" --title "$I18N_TITLE_WSJTX_ASK" \
    --yesno "$I18N_MSG_WSJTX_ASK" 13 66; then
    _install_wsjtx=1; _wsjtx_label="$I18N_LABEL_WSJTX_YES"
  fi
fi

# ── INSTALL MODE ───────────────────────────────────────────────────────────────
_install_mode=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_INSTALL_MODE" \
  --menu "$I18N_MSG_INSTALL_MODE" \
  12 70 2 \
  "systemd" "$I18N_OPT_SYSTEMD" \
  "manual"  "$I18N_OPT_MANUAL" \
  3>&1 1>&2 2>&3) || exit 0

_install_mode_label="$I18N_LABEL_SYSTEMD"
[[ "$_install_mode" == "manual" ]] && _install_mode_label="$I18N_LABEL_MANUAL"

# ── OPERATOR USERNAME ──────────────────────────────────────────────────────────
_op_user=""
while [[ -z "$_op_user" ]]; do
  _op_user=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_OP_USER" \
    --inputbox "$I18N_MSG_OP_USER" \
    9 62 "ct7bfv" 3>&1 1>&2 2>&3) || exit 0
  _op_user="${_op_user//[[:space:]]/}"
  [[ -z "$_op_user" ]] && whiptail --backtitle "$BT" --title "$I18N_TITLE_ERR" \
    --msgbox "$I18N_MSG_ERR_USER_EMPTY" 7 50
done

# ── OPERATOR PASSWORD ──────────────────────────────────────────────────────────
_op_pass=""
while true; do
  _op_pass=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_OP_PASS" \
    --passwordbox "$(i18n_fmt "$I18N_MSG_OP_PASS" USER "$_op_user")" \
    9 62 "" 3>&1 1>&2 2>&3) || exit 0

  if [[ -z "$_op_pass" ]]; then
    whiptail --backtitle "$BT" --title "$I18N_TITLE_ERR" \
      --msgbox "$I18N_MSG_ERR_PASS_EMPTY" 7 46
    continue
  fi
  if [[ ${#_op_pass} -lt 8 ]]; then
    whiptail --backtitle "$BT" --title "$I18N_TITLE_WEAK_PASS" \
      --yesno "$I18N_MSG_WEAK_PASS" 8 54 || continue
  fi

  _op_pass2=$(whiptail --backtitle "$BT" --title "$I18N_TITLE_OP_PASS2" \
    --passwordbox "$I18N_MSG_OP_PASS2" \
    9 62 "" 3>&1 1>&2 2>&3) || exit 0

  if [[ "$_op_pass" == "$_op_pass2" ]]; then break; fi
  whiptail --backtitle "$BT" --title "$I18N_TITLE_ERR" \
    --msgbox "$I18N_MSG_ERR_PASS_MISMATCH" 7 52
done
unset _op_pass2

# ── CONFIRMATION ───────────────────────────────────────────────────────────────
_ui_lang_label="$UI_LANG"
_ui_locale_sh="$ROOT_DIR/locales/${UI_LANG}.sh"
if [[ -f "$_ui_locale_sh" ]]; then
  _ui_lang_label=$(bash -c "source \"$_ui_locale_sh\" 2>/dev/null && printf '%s' \"\$LANG_NATIVE_NAME\"" 2>/dev/null || echo "$UI_LANG")
fi

whiptail --backtitle "$BT" --title "$I18N_TITLE_CONFIRM" \
  --yesno "$(i18n_fmt "$I18N_MSG_CONFIRM" \
    OS  "$OS_PRETTY_NAME" \
    RADIO "$_radio_label" \
    RTLSDR "$_rtlsdr_label" \
    WSJTX "$_wsjtx_label" \
    MODE  "$_install_mode_label" \
    USER  "$_op_user" \
    UILANG "$_ui_lang_label" \
    LOG   "$LOG_FILE")" \
  22 68 || exit 0

# ── INSTALLATION ───────────────────────────────────────────────────────────────
start_gauge "$I18N_GAUGE_TITLE"

gauge_step 5 "$I18N_GAUGE_APT_UPDATE"
run_sudo apt-get update -qq >> "$LOG_FILE" 2>&1 \
  || abort "apt-get update"

gauge_step 15 "$I18N_GAUGE_APT_DEPS"
run_sudo apt-get install -y \
  python3 python3-pip python3-venv python3-dev \
  libhamlib-utils \
  libavcodec-dev libavformat-dev libavdevice-dev libswresample-dev \
  libopus-dev \
  libportaudio2 portaudio19-dev \
  openssl git curl \
  >> "$LOG_FILE" 2>&1 \
  || abort "apt-get install"

gauge_step 20 "$I18N_GAUGE_DIALOUT"
run_sudo usermod -aG dialout "$SERVICE_USER" >> "$LOG_FILE" 2>&1 \
  || echo "[WARN] usermod dialout falhou" >> "$LOG_FILE"

if [[ $_install_wsjtx -eq 1 ]]; then
  gauge_step 25 "$I18N_GAUGE_WSJTX"
  run_sudo apt-get install -y wsjtx >> "$LOG_FILE" 2>&1 \
    || { echo "[WARN] wsjtx unavailable" >> "$LOG_FILE"; _install_wsjtx=0; }
  # Mark as present if installation succeeded
  [[ $_install_wsjtx -eq 1 ]] && _wsjtx_present=1
fi

if [[ $_use_rtlsdr -eq 1 ]]; then
  if [[ $_use_rtlsdr_v4 -eq 1 ]]; then
    gauge_step 29 "$I18N_GAUGE_RTLSDR_V4"
    # Instalar dependências de compilação
    run_sudo apt-get install -y git cmake libusb-1.0-0-dev build-essential >> "$LOG_FILE" 2>&1 \
      || echo "[WARN] dependências v4 falharam" >> "$LOG_FILE"
    # Remover driver conflituoso do apt
    run_sudo apt-get remove -y rtl-sdr librtlsdr0 librtlsdr-dev >> "$LOG_FILE" 2>&1 || true
    # Compilar driver RTL-SDR Blog v4
    _rtlsdr_build_dir="$(mktemp -d /tmp/rtlsdr-blog-XXXXXX)"
    _TMPFILES+=("$_rtlsdr_build_dir")
    git clone --depth=1 https://github.com/rtlsdrblog/rtl-sdr-blog "$_rtlsdr_build_dir" >> "$LOG_FILE" 2>&1 \
      || { echo "[WARN] clone rtl-sdr-blog falhou — a usar driver apt" >> "$LOG_FILE"; _use_rtlsdr_v4=0; }
    if [[ $_use_rtlsdr_v4 -eq 1 ]]; then
      mkdir -p "$_rtlsdr_build_dir/build"
      cmake -S "$_rtlsdr_build_dir" -B "$_rtlsdr_build_dir/build" -DINSTALL_UDEV_RULES=ON >> "$LOG_FILE" 2>&1
      make -C "$_rtlsdr_build_dir/build" >> "$LOG_FILE" 2>&1
      run_sudo make -C "$_rtlsdr_build_dir/build" install >> "$LOG_FILE" 2>&1
      run_sudo ldconfig >> "$LOG_FILE" 2>&1
      # Blacklist módulos conflituosos do kernel
      run_sudo tee /etc/modprobe.d/blacklist-rtl.conf > /dev/null <<'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
EOF
      run_sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true
    fi
  else
    gauge_step 29 "$I18N_GAUGE_RTLSDR"
    run_sudo apt-get install -y rtl-sdr usbutils >> "$LOG_FILE" 2>&1 \
      || echo "[WARN] rtl-sdr apt install falhou" >> "$LOG_FILE"
  fi

  # Adicionar utilizador ao grupo plugdev (acesso ao USB sem sudo)
  run_sudo usermod -aG plugdev "$SERVICE_USER" >> "$LOG_FILE" 2>&1 \
    || echo "[WARN] usermod plugdev falhou" >> "$LOG_FILE"

  # Instalar pyrtlsdr (binding Python)
  "$PYTHON_BIN" -m pip install --quiet pyrtlsdr >> "$LOG_FILE" 2>&1 \
    || echo "[WARN] pyrtlsdr pip install falhou — RTL-SDR pode não funcionar" >> "$LOG_FILE"
fi

gauge_step 35 "$I18N_GAUGE_VENV"
if [[ ! -x "$PYTHON_BIN" ]]; then
  python3 -m venv "$VENV_DIR" >> "$LOG_FILE" 2>&1 \
    || abort "venv creation"
fi

gauge_step 45 "$I18N_GAUGE_PIP"
"$PYTHON_BIN" -m pip install --quiet --upgrade pip setuptools wheel >> "$LOG_FILE" 2>&1
"$PYTHON_BIN" -m pip install --quiet -r "$ROOT_DIR/backend/requirements.txt" >> "$LOG_FILE" 2>&1 \
  || abort "pip install"

# Auto-detectar dispositivo de áudio USB (procurar USB Audio / PCM29xx / Burr-Brown)
gauge_step 52 "$I18N_GAUGE_AUDIO_DETECT"
_audio_device=$("$PYTHON_BIN" -c "
import sounddevice as sd
devs = sd.query_devices()
for d in devs:
    name = d['name']
    if d['max_input_channels'] > 0 and any(k in name for k in ('USB Audio', 'USB AUDIO', 'PCM29', 'Burr-Brown')):
        print(name)
        break
" 2>/dev/null || echo "")
if [[ -n "$_audio_device" ]]; then
  echo "[INFO] Dispositivo de áudio detectado: $_audio_device" >> "$LOG_FILE"
else
  echo "[WARN] Nenhum dispositivo USB Audio detectado — a usar null (default)" >> "$LOG_FILE"
fi

gauge_step 60 "$I18N_GAUGE_RADIO_CFG"
_cfg="$ROOT_DIR/config/remote_config.yaml"
[[ ! -f "$_cfg" ]] && cp "$ROOT_DIR/config/remote_config.example.yaml" "$_cfg"
sed -i "s/^  profile:.*/  profile: \"${_radio_profile}\"/" "$_cfg"
[[ "$_radio_profile" == "x6100" ]] && \
  sed -i "s/^    host:.*/    host: \"${_x6100_ip}\"/" "$_cfg"
# Escrever o device de áudio detectado
if [[ -n "${_audio_device:-}" ]]; then
  sed -i "s|^  device:.*|  device: \"${_audio_device}\"|" "$_cfg"
fi

gauge_step 70 "$I18N_GAUGE_CERTS"
if [[ ! -f "$ROOT_DIR/certs/cert.pem" ]]; then
  bash "$ROOT_DIR/scripts/gen_certs.sh" >> "$LOG_FILE" 2>&1 \
    || abort "TLS cert generation"
fi

gauge_step 80 "$I18N_GAUGE_CREDS"
_tmp_py="$(mktemp /tmp/4ham-setup-XXXXXX.py)"
_TMPFILES+=("$_tmp_py")
chmod 600 "$_tmp_py"

# Write the Python helper to the temp file — no heredoc, avoids delimiter conflicts
python3 -c "
import sys
content = '''import sys, os
root     = sys.argv[1]
username = sys.argv[2]
ui_lang  = sys.argv[3]
spectrum_source = sys.argv[4] if len(sys.argv) > 4 else \"audio_fft\"
password = sys.stdin.read()
sys.path.insert(0, os.path.join(root, \"backend\"))
import bcrypt, yaml
cfg_path = os.path.join(root, \"config\", \"remote_config.yaml\")
with open(cfg_path, encoding=\"utf-8\") as f:
    cfg = yaml.safe_load(f) or {}
pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
cfg.setdefault(\"auth\", {})[\"users\"] = [{
    \"username\": username,
    \"password_hash\": pw_hash,
    \"role\": \"operator\",
}]
cfg.setdefault(\"ui\", {})[\"language\"] = ui_lang
cfg.setdefault(\"spectrum\", {})[\"source\"] = spectrum_source
if spectrum_source == \"rtlsdr\":
    cfg[\"spectrum\"].setdefault(\"rtlsdr\", {}).update({
        \"device_index\": 0,
        \"sample_rate\": 250000,
        \"ppm_correction\": 0,
        \"gain\": 30.0,
        \"span_hz\": 100000,
    })
with open(cfg_path, \"w\", encoding=\"utf-8\") as f:
    yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False)
'''
with open(sys.argv[1], 'w') as fh:
    fh.write(content)
" "$_tmp_py"

printf '%s' "$_op_pass" \
  | "$PYTHON_BIN" "$_tmp_py" "$ROOT_DIR" "$_op_user" "$UI_LANG" "$_spectrum_source" >> "$LOG_FILE" 2>&1 \
  || abort "saving credentials"

rm -f "$_tmp_py"
unset _op_pass

gauge_step 88 "$I18N_GAUGE_RUNSH"
chmod +x "$ROOT_DIR/scripts/4ham_control.sh"
chmod +x "$ROOT_DIR/scripts/4ham-remote-launcher.sh"

if [[ "$_install_mode" == "systemd" ]]; then
  gauge_step 95 "$I18N_GAUGE_SYSTEMD"
  _svc_file="/etc/systemd/system/${SERVICE_NAME}.service"
  printf '[Unit]\nDescription=4ham Remote Operation\nAfter=network.target\n\n[Service]\nType=simple\nUser=%s\nWorkingDirectory=%s\nEnvironment=REMOTE_CONFIG=%s/config/remote_config.yaml\nExecStart=%s/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8001 --ssl-certfile %s/certs/cert.pem --ssl-keyfile %s/certs/key.pem\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
    "$SERVICE_USER" "$ROOT_DIR" "$ROOT_DIR" "$VENV_DIR" "$ROOT_DIR" "$ROOT_DIR" \
    | run_sudo tee "$_svc_file" > /dev/null
  run_sudo systemctl daemon-reload  >> "$LOG_FILE" 2>&1
  run_sudo systemctl enable "${SERVICE_NAME}" >> "$LOG_FILE" 2>&1
  run_sudo systemctl start  "${SERVICE_NAME}" >> "$LOG_FILE" 2>&1 || true
fi

close_gauge

# ── DESKTOP SHORTCUT ───────────────────────────────────────────────────────────
_desktop_created=0
if [[ -n "${XDG_CURRENT_DESKTOP:-}" || -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  if whiptail --backtitle "$BT" --title "$I18N_TITLE_DESKTOP" \
    --yesno "$I18N_MSG_DESKTOP" 13 66; then

    if command -v xdg-user-dir >/dev/null 2>&1; then
      _desktop_dir="${XDG_DESKTOP_DIR:-$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")}"
    else
      _desktop_dir="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
    fi
    _app_dir="$HOME/.local/share/applications"
    _launcher="$ROOT_DIR/scripts/4ham-remote-launcher.sh"

    # Load comments from both locales for multilingual .desktop
    _comment_pt=$(bash -c "source \"$ROOT_DIR/locales/pt.sh\" 2>/dev/null && printf '%s' \"\$I18N_DESKTOP_COMMENT\"" 2>/dev/null || echo "$I18N_DESKTOP_COMMENT")
    _comment_en=$(bash -c "source \"$ROOT_DIR/locales/en.sh\" 2>/dev/null && printf '%s' \"\$I18N_DESKTOP_COMMENT\"" 2>/dev/null || echo "$I18N_DESKTOP_COMMENT")

    mkdir -p "$_desktop_dir" "$_app_dir"

    python3 -c "
import sys
name, launcher, comment_en, comment_pt = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = '[Desktop Entry]\nVersion=1.0\nType=Application\nName=%s\nName[en]=%s\nName[pt]=%s\nComment=%s\nComment[en]=%s\nComment[pt]=%s\nExec=bash -c ' % (name,name,name,comment_en,comment_en,comment_pt)
s += \"'exec \" + launcher + \"'\n\"
s += 'Icon=network-wired\nTerminal=true\nCategories=HamRadio;Network;\nStartupNotify=false\n'
with open(sys.argv[5], 'w') as f: f.write(s)
" "$I18N_DESKTOP_APP_NAME" "$_launcher" \
      "$_comment_en" "$_comment_pt" \
      "$_desktop_dir/4ham-Remote-Operation.desktop"

    cp "$_desktop_dir/4ham-Remote-Operation.desktop" \
       "$_app_dir/4ham-Remote-Operation.desktop"
    chmod +x "$_desktop_dir/4ham-Remote-Operation.desktop"
    chmod +x "$_app_dir/4ham-Remote-Operation.desktop"

    command -v gio >/dev/null 2>&1 && \
      gio set "$_desktop_dir/4ham-Remote-Operation.desktop" metadata::trusted true 2>/dev/null || true

    _desktop_created=1
  fi
fi

# ── COMPLETION ─────────────────────────────────────────────────────────────────
_local_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
_wsjtx_note=""
[[ $_wsjtx_present -eq 0 ]] && _wsjtx_note="$I18N_MSG_WSJTX_NOTE"

if [[ "$_install_mode" == "systemd" ]]; then
  whiptail --backtitle "$BT" --title "$I18N_TITLE_DONE" \
    --ok-button "$I18N_BTN_EXIT_INSTALLER" \
    --msgbox "$(i18n_fmt "$I18N_MSG_DONE_SYSTEMD" \
      IP "$_local_ip" USER "$_op_user" SVC "$SERVICE_NAME" \
      LOG "$LOG_FILE" WSJTX_NOTE "$_wsjtx_note")" \
    24 70
else
  whiptail --backtitle "$BT" --title "$I18N_TITLE_DONE" \
    --ok-button "$I18N_BTN_EXIT_INSTALLER" \
    --msgbox "$(i18n_fmt "$I18N_MSG_DONE_MANUAL" \
      IP "$_local_ip" USER "$_op_user" \
      LOG "$LOG_FILE" WSJTX_NOTE "$_wsjtx_note")" \
    22 70
fi

# Repor estado do terminal após ncurses (whiptail), para que o fecho da
# janela funcione correctamente.
stty sane 2>/dev/null || true
