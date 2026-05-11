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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"
LOG_FILE="/tmp/4ham-remote-install-$(date +%Y%m%d-%H%M%S).log"
SERVICE_NAME="4ham-remote"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
BT="4ham Remote Operation — Installer"

FIFO=""
GAUGE_PID=""
declare -a _TMPFILES=()

# ── helpers ─────────────────────────────────────────────────────────────────────
run_sudo() { [[ "${EUID}" -eq 0 ]] && "$@" || sudo "$@"; }

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# ── cleanup ──────────────────────────────────────────────────────────────────────
cleanup() {
  exec 3>&- 2>/dev/null || true
  [[ -n "${GAUGE_PID:-}" ]] && kill "${GAUGE_PID}" 2>/dev/null || true
  [[ -n "${FIFO:-}"      ]] && rm -f "${FIFO}"    2>/dev/null || true
  for _f in "${_TMPFILES[@]:-}"; do rm -f "$_f" 2>/dev/null || true; done
}
trap cleanup EXIT

# ── gauge ────────────────────────────────────────────────────────────────────────
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
  printf 'XXX\n100\nConcluido.\nXXX\n' >&3 2>/dev/null || true
  exec 3>&- 2>/dev/null || true
  wait "${GAUGE_PID}" 2>/dev/null || true
  rm -f "${FIFO}"; FIFO=""; GAUGE_PID=""
}

abort() {
  exec 3>&- 2>/dev/null || true
  [[ -n "${GAUGE_PID:-}" ]] && { kill "${GAUGE_PID}" 2>/dev/null || true; wait "${GAUGE_PID}" 2>/dev/null || true; GAUGE_PID=""; }
  [[ -n "${FIFO:-}" ]] && { rm -f "${FIFO}"; FIFO=""; }
  whiptail --backtitle "$BT" --title "Erro na instalacao" \
    --msgbox "Ocorreu um erro durante a instalacao.\n\nDetalhe: $1\n\nLog completo:\n  $LOG_FILE" 13 70
  exit 1
}

# ── compatibilidade OS ───────────────────────────────────────────────────────────
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

# ── verificacoes iniciais ────────────────────────────────────────────────────────
if [[ "${EUID}" -eq 0 ]]; then
  echo "Nao correr como root. Usar um utilizador normal com acesso sudo: ./install.sh" >&2
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  echo "Este instalador requer apt (Ubuntu/Debian/Mint/Raspberry Pi OS)." >&2
  exit 1
fi

# garantir whiptail disponivel
if ! command -v whiptail &>/dev/null; then
  echo "A instalar whiptail para interface grafica..."
  run_sudo apt-get update -qq
  run_sudo apt-get install -y whiptail
fi

if ! detect_os; then
  whiptail --backtitle "$BT" --title "SO nao suportado" \
    --msgbox "SO detectado: ${OS_PRETTY_NAME:-desconhecido} (${OS_VERSION_ID:-?})\n\nVersoes minimas suportadas:\n  Ubuntu 20.04+\n  Debian 11+\n  Linux Mint 20+\n  Raspberry Pi OS 11+" \
    14 62
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  whiptail --backtitle "$BT" --title "Python nao encontrado" \
    --msgbox "python3 nao encontrado.\nInstalar primeiro: sudo apt install python3" 8 54
  exit 1
fi

_pyok=$(python3 -c "import sys; print('ok' if sys.version_info>=(3,11) else 'old')" 2>/dev/null || echo old)
if [[ "$_pyok" != "ok" ]]; then
  whiptail --backtitle "$BT" --title "Versao de Python" \
    --msgbox "Python 3.11+ necessario.\nDetectado: $(python3 --version 2>&1)" 8 54
  exit 1
fi

# ── ecra de boas-vindas ──────────────────────────────────────────────────────────
whiptail --backtitle "$BT" --title "Bem-vindo" \
  --msgbox "\
Bem-vindo ao instalador do 4ham Remote Operation!

Este assistente ira:
  1. Instalar dependencias de sistema (Hamlib, FFmpeg, Opus, PortAudio, ...)
  2. Instalar WSJT-X -- jt9/wsprd para FT8/FT4/WSPR (fase R3, opcional)
  3. Criar o ambiente Python virtual (venv)
  4. Instalar dependencias Python (FastAPI, aiortc, sounddevice, ...)
  5. Configurar o perfil do radio (FT-991A ou Xiegu X6100)
  6. Gerar certificados TLS para HTTPS (necessario para WebRTC)
  7. Criar conta de operador (Basic Auth bcrypt)
  8. Instalar servico systemd (opcional)

Pre-requisitos: acesso a internet e direitos sudo.
SO detectado: ${OS_PRETTY_NAME} -- suportado.

Prima Enter para continuar." \
  22 68

# ── perfil do radio ──────────────────────────────────────────────────────────────
_radio_profile=$(whiptail --backtitle "$BT" --title "Perfil do Radio" \
  --menu "Selecione o radio principal desta estacao:" \
  14 68 2 \
  "ft991a" "Yaesu FT-991A  (USB Serial -> rigctld, USB Audio 48kHz)" \
  "x6100"  "Xiegu X6100    (WiFi/Ethernet nativo, IP configuravel)" \
  3>&1 1>&2 2>&3) || exit 0

_radio_label="Yaesu FT-991A"
[[ "$_radio_profile" == "x6100" ]] && _radio_label="Xiegu X6100"

# ── IP do X6100 (se seleccionado) ────────────────────────────────────────────────
_x6100_ip="192.168.1.100"
if [[ "$_radio_profile" == "x6100" ]]; then
  _x6100_ip=$(whiptail --backtitle "$BT" --title "Xiegu X6100 -- Endereco IP" \
    --inputbox "Endereco IP do X6100 na rede local:" \
    9 60 "192.168.1.100" 3>&1 1>&2 2>&3) || exit 0
fi

# ── WSJT-X (jt9 + wsprd) ────────────────────────────────────────────────────────
_install_wsjtx=0
_wsjtx_label="Nao (instalar depois para FT8/FT4/WSPR)"
if whiptail --backtitle "$BT" --title "WSJT-X -- Modos Digitais (R3)" \
  --yesno "\
Instalar WSJT-X (jt9 + wsprd)?

Necessario para descodificacao de FT8, FT4 e WSPR (fase R3).
Nao e necessario para a fase R1 (RX audio) nem R2 (TX SSB).

  SIM  ->  sudo apt install wsjtx  (~50 MB)
  NAO  ->  ignorar por agora" \
  13 66; then
  _install_wsjtx=1
  _wsjtx_label="Sim (wsjtx -- jt9 + wsprd)"
fi

# ── modo de instalacao ───────────────────────────────────────────────────────────
_install_mode=$(whiptail --backtitle "$BT" --title "Modo de Instalacao" \
  --menu "Como pretende correr o 4ham Remote Operation?" \
  12 70 2 \
  "systemd" "Servico systemd -- arranque automatico com o sistema (recomendado)" \
  "manual"  "Arranque manual pelo utilizador -- usar ./run.sh" \
  3>&1 1>&2 2>&3) || exit 0

_install_mode_label="Servico systemd (auto-start)"
[[ "$_install_mode" == "manual" ]] && _install_mode_label="Arranque manual (./run.sh)"

# ── utilizador operador ──────────────────────────────────────────────────────────
_op_user=""
while [[ -z "$_op_user" ]]; do
  _op_user=$(whiptail --backtitle "$BT" --title "Conta de Operador -- Utilizador" \
    --inputbox "Nome de utilizador para acesso a interface web:" \
    9 62 "ct7bfv" 3>&1 1>&2 2>&3) || exit 0
  _op_user="${_op_user//[[:space:]]/}"
  [[ -z "$_op_user" ]] && whiptail --backtitle "$BT" --title "Erro" \
    --msgbox "O nome de utilizador nao pode ser vazio." 7 44
done

# ── password operador ────────────────────────────────────────────────────────────
_op_pass=""
while true; do
  _op_pass=$(whiptail --backtitle "$BT" --title "Conta de Operador -- Password" \
    --passwordbox "Password para '${_op_user}':" \
    9 62 "" 3>&1 1>&2 2>&3) || exit 0

  if [[ -z "$_op_pass" ]]; then
    whiptail --backtitle "$BT" --title "Erro" --msgbox "A password nao pode ser vazia." 7 42; continue
  fi
  if [[ ${#_op_pass} -lt 8 ]]; then
    whiptail --backtitle "$BT" --title "Password Fraca" \
      --yesno "A password tem menos de 8 caracteres.\nContinuar mesmo assim?" 8 52 || continue
  fi

  _op_pass2=$(whiptail --backtitle "$BT" --title "Conta de Operador -- Confirmar Password" \
    --passwordbox "Confirmar password:" \
    9 62 "" 3>&1 1>&2 2>&3) || exit 0

  [[ "$_op_pass" == "$_op_pass2" ]] && break
  whiptail --backtitle "$BT" --title "Erro" --msgbox "As passwords nao coincidem." 7 42
done
unset _op_pass2

# ── confirmacao ──────────────────────────────────────────────────────────────────
whiptail --backtitle "$BT" --title "Confirmar Instalacao" \
  --yesno "\
Pronto para instalar. Resumo:

  SO              : ${OS_PRETTY_NAME}
  Radio           : $_radio_label
  WSJT-X (R3)     : $_wsjtx_label
  Modo instalacao : $_install_mode_label
  Utilizador      : $_op_user
  Log             : $LOG_FILE

Prosseguir com a instalacao?" \
  18 68 || exit 0

# ── INSTALACAO ───────────────────────────────────────────────────────────────────
start_gauge "A instalar 4ham Remote Operation -- aguarde..."

gauge_step 5 "A actualizar lista de pacotes..."
run_sudo apt-get update -qq >> "$LOG_FILE" 2>&1 \
  || abort "apt-get update falhou"

gauge_step 15 "A instalar dependencias de sistema..."
run_sudo apt-get install -y \
  python3 python3-pip python3-venv python3-dev \
  libhamlib-utils \
  libavcodec-dev libavformat-dev libavdevice-dev libswresample-dev \
  libopus-dev \
  libportaudio2 portaudio19-dev \
  openssl git curl \
  >> "$LOG_FILE" 2>&1 \
  || abort "Instalacao de pacotes de sistema falhou"

if [[ $_install_wsjtx -eq 1 ]]; then
  gauge_step 25 "A instalar WSJT-X (jt9 + wsprd)..."
  run_sudo apt-get install -y wsjtx >> "$LOG_FILE" 2>&1 \
    || { echo "[WARN] wsjtx nao disponivel no repositorio" >> "$LOG_FILE"; _install_wsjtx=0; }
fi

gauge_step 35 "A criar ambiente Python virtual..."
if [[ ! -x "$PYTHON_BIN" ]]; then
  python3 -m venv "$VENV_DIR" >> "$LOG_FILE" 2>&1 \
    || abort "Falha ao criar venv"
fi

gauge_step 45 "A instalar dependencias Python (FastAPI, aiortc, sounddevice, ...)..."
"$PYTHON_BIN" -m pip install --quiet --upgrade pip setuptools wheel >> "$LOG_FILE" 2>&1
"$PYTHON_BIN" -m pip install --quiet -r "$ROOT_DIR/backend/requirements.txt" >> "$LOG_FILE" 2>&1 \
  || abort "pip install falhou -- ver $LOG_FILE"

gauge_step 60 "A configurar perfil do radio..."
_cfg="$ROOT_DIR/config/remote_config.yaml"
if [[ ! -f "$_cfg" ]]; then
  cp "$ROOT_DIR/config/remote_config.example.yaml" "$_cfg"
fi
# injectar perfil seleccionado
sed -i "s/^  profile:.*/  profile: \"${_radio_profile}\"/" "$_cfg"
if [[ "$_radio_profile" == "x6100" ]]; then
  sed -i "s/^    host:.*/    host: \"${_x6100_ip}\"/" "$_cfg"
fi

gauge_step 70 "A gerar certificados TLS auto-assinados..."
if [[ ! -f "$ROOT_DIR/certs/cert.pem" ]]; then
  bash "$ROOT_DIR/scripts/gen_certs.sh" >> "$LOG_FILE" 2>&1 \
    || abort "Geracao de certificados falhou"
fi

gauge_step 80 "A guardar credenciais do operador..."
_tmp_py="$(mktemp /tmp/4ham-setup-XXXXXX.py)"
_TMPFILES+=("$_tmp_py")
chmod 600 "$_tmp_py"

cat > "$_tmp_py" << 'PYEOF'
import sys, os
root     = sys.argv[1]
username = sys.argv[2]
password = sys.stdin.read()

sys.path.insert(0, os.path.join(root, "backend"))
import bcrypt, yaml

cfg_path = os.path.join(root, "config", "remote_config.yaml")
with open(cfg_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f) or {}

pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

cfg.setdefault("auth", {})["users"] = [{
    "username": username,
    "password_hash": pw_hash,
    "role": "operator",
}]

with open(cfg_path, "w", encoding="utf-8") as f:
    yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False)
PYEOF

printf '%s' "$_op_pass" \
  | "$PYTHON_BIN" "$_tmp_py" "$ROOT_DIR" "$_op_user" >> "$LOG_FILE" 2>&1 \
  || abort "Falha ao guardar credenciais"

rm -f "$_tmp_py"
unset _op_pass

gauge_step 88 "A criar script de arranque (run.sh)..."
cat > "$ROOT_DIR/run.sh" << 'RUNEOF'
#!/usr/bin/env bash
# 4ham Remote Operation -- arranque rapido (desenvolvimento / modo manual)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REMOTE_CONFIG="$ROOT_DIR/config/remote_config.yaml"
"$ROOT_DIR/.venv/bin/uvicorn" backend.app.main:app \
    --host 0.0.0.0 --port 8000 \
    --ssl-certfile "$ROOT_DIR/certs/cert.pem" \
    --ssl-keyfile  "$ROOT_DIR/certs/key.pem" \
    --reload
RUNEOF
chmod +x "$ROOT_DIR/run.sh"

if [[ "$_install_mode" == "systemd" ]]; then
  gauge_step 95 "A instalar servico systemd..."
  _svc_file="/etc/systemd/system/${SERVICE_NAME}.service"
  run_sudo tee "$_svc_file" > /dev/null << EOF
[Unit]
Description=4ham Remote Operation
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT_DIR}
Environment=REMOTE_CONFIG=${ROOT_DIR}/config/remote_config.yaml
ExecStart=${VENV_DIR}/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --ssl-certfile ${ROOT_DIR}/certs/cert.pem --ssl-keyfile ${ROOT_DIR}/certs/key.pem
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  run_sudo systemctl daemon-reload  >> "$LOG_FILE" 2>&1
  run_sudo systemctl enable "${SERVICE_NAME}" >> "$LOG_FILE" 2>&1
  run_sudo systemctl start  "${SERVICE_NAME}" >> "$LOG_FILE" 2>&1 || true
fi

close_gauge

# ── ecra de conclusao ────────────────────────────────────────────────────────────
_local_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

_wsjtx_note=""
[[ $_install_wsjtx -eq 0 ]] && _wsjtx_note="\n  WSJT-X nao instalado -- FT8/WSPR requerem: sudo apt install wsjtx"

if [[ "$_install_mode" == "systemd" ]]; then
  whiptail --backtitle "$BT" --title "Instalacao Concluida!" \
    --msgbox "\
4ham Remote Operation instalado e em execucao!

Abrir no browser:
  https://${_local_ip}:8000/
  https://127.0.0.1:8000/

Login:
  Utilizador : $_op_user
  Password   : (a que definiu)

Gestao do servico:
  Estado   sudo systemctl status ${SERVICE_NAME}
  Logs     journalctl -u ${SERVICE_NAME} -f
  Restart  sudo systemctl restart ${SERVICE_NAME}
  Parar    sudo systemctl stop ${SERVICE_NAME}

Log de instalacao: $LOG_FILE
${_wsjtx_note}" \
    24 70
else
  whiptail --backtitle "$BT" --title "Instalacao Concluida!" \
    --msgbox "\
4ham Remote Operation instalado (modo manual).

Para iniciar o servidor:
  ./run.sh

Abrir no browser:
  https://${_local_ip}:8000/
  https://127.0.0.1:8000/

Login:
  Utilizador : $_op_user
  Password   : (a que definiu)

Log de instalacao: $LOG_FILE
${_wsjtx_note}" \
    22 70
fi
