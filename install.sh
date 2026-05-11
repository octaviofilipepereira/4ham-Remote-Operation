#!/usr/bin/env bash
# © 2026 Octávio Filipe Gonçalves — CT7BFV
# License: GNU GPL-3.0
#
# 4ham Remote Operation — Linux Installer
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
LOG_FILE="/tmp/4ham-remote-install-$(date +%Y%m%d-%H%M%S).log"
SERVICE_NAME="4ham-remote"
SERVICE_USER="${SUDO_USER:-$(whoami)}"

# ── cores ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERRO]${RESET}  $*" >&2; exit 1; }
run_sudo(){ [[ "${EUID}" -eq 0 ]] && "$@" || sudo "$@"; }

# ── compatibilidade OS ─────────────────────────────────────────────────────────
check_os() {
  [[ -f /etc/os-release ]] || die "Sistema não suportado: /etc/os-release não encontrado."
  # shellcheck disable=SC1091
  source /etc/os-release
  local id="${ID,,}"
  case "$id" in
    ubuntu|debian|linuxmint|raspbian) ok "OS detectado: ${PRETTY_NAME}" ;;
    *) warn "OS '${PRETTY_NAME}' não testado — a tentar instalar na mesma." ;;
  esac
}

# ── dependências apt ───────────────────────────────────────────────────────────
APT_PKGS=(
  python3
  python3-pip
  python3-venv
  python3-dev
  # Hamlib — rigctld
  libhamlib-utils
  # FFmpeg / libav (necessário para aiortc/av)
  libavcodec-dev
  libavformat-dev
  libavdevice-dev
  libswresample-dev
  # Opus (áudio WebRTC)
  libopus-dev
  # PortAudio (sounddevice)
  libportaudio2
  portaudio19-dev
  # SSL
  openssl
  # Utilitários
  git
  curl
)

install_apt_deps() {
  info "A actualizar lista de pacotes..."
  run_sudo apt-get update -qq >> "$LOG_FILE" 2>&1
  info "A instalar dependências de sistema..."
  run_sudo apt-get install -y "${APT_PKGS[@]}" >> "$LOG_FILE" 2>&1
  ok "Dependências de sistema instaladas."
}

# ── WSJT-X (jt9 + wsprd) — opcional, necessário para R3 ──────────────────────
install_wsjtx() {
  if command -v jt9 &>/dev/null; then
    ok "jt9 já instalado: $(command -v jt9)"
    return
  fi
  info "A instalar wsjtx (FT8/FT4/WSPR — fase R3)..."
  run_sudo apt-get install -y wsjtx >> "$LOG_FILE" 2>&1 && ok "wsjtx instalado." \
    || warn "wsjtx não disponível no repositório — instalar manualmente para FT8/WSPR."
}

# ── venv Python ───────────────────────────────────────────────────────────────
create_venv() {
  if [[ -d "$VENV_DIR" ]]; then
    warn "venv já existe em $VENV_DIR — a reutilizar."
  else
    info "A criar venv em $VENV_DIR..."
    python3 -m venv "$VENV_DIR" >> "$LOG_FILE" 2>&1
    ok "venv criado."
  fi
}

install_python_deps() {
  info "A instalar dependências Python (pode demorar)..."
  "$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel >> "$LOG_FILE" 2>&1
  "$VENV_DIR/bin/pip" install -r "$ROOT_DIR/backend/requirements.txt" >> "$LOG_FILE" 2>&1
  ok "Dependências Python instaladas."
}

# ── configuração ───────────────────────────────────────────────────────────────
setup_config() {
  local cfg="$ROOT_DIR/config/remote_config.yaml"
  if [[ -f "$cfg" ]]; then
    warn "Ficheiro de config já existe: $cfg — não substituído."
  else
    cp "$ROOT_DIR/config/remote_config.example.yaml" "$cfg"
    ok "Config copiada para $cfg — editar antes de iniciar."
  fi
}

# ── certificados TLS ───────────────────────────────────────────────────────────
setup_certs() {
  local cert="$ROOT_DIR/certs/cert.pem"
  local key="$ROOT_DIR/certs/key.pem"
  if [[ -f "$cert" && -f "$key" ]]; then
    warn "Certificados já existem — não substituídos."
    return
  fi
  info "A gerar certificados TLS auto-assinados para desenvolvimento..."
  bash "$ROOT_DIR/scripts/gen_certs.sh" >> "$LOG_FILE" 2>&1
  ok "Certificados gerados em $ROOT_DIR/certs/"
  warn "Para produção, substituir por certificados Let's Encrypt."
}

# ── serviço systemd ────────────────────────────────────────────────────────────
install_systemd_service() {
  local svc_file="/etc/systemd/system/${SERVICE_NAME}.service"
  if [[ -f "$svc_file" ]]; then
    warn "Serviço systemd já existe — não substituído."
    return
  fi

  info "A criar serviço systemd ${SERVICE_NAME}..."
  run_sudo tee "$svc_file" > /dev/null <<EOF
[Unit]
Description=4ham Remote Operation
After=network.target
Wants=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT_DIR}
Environment=REMOTE_CONFIG=${ROOT_DIR}/config/remote_config.yaml
ExecStart=${VENV_DIR}/bin/uvicorn backend.app.main:app \\
    --host 0.0.0.0 --port 8000 \\
    --ssl-certfile ${ROOT_DIR}/certs/cert.pem \\
    --ssl-keyfile  ${ROOT_DIR}/certs/key.pem
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  run_sudo systemctl daemon-reload
  run_sudo systemctl enable "${SERVICE_NAME}"
  ok "Serviço ${SERVICE_NAME} instalado e activado."
  info "Para iniciar: sudo systemctl start ${SERVICE_NAME}"
  info "Para ver logs: journalctl -u ${SERVICE_NAME} -f"
}

# ── script de arranque rápido ──────────────────────────────────────────────────
create_run_script() {
  local run_sh="$ROOT_DIR/run.sh"
  cat > "$run_sh" <<EOF
#!/usr/bin/env bash
# Arranque rápido sem systemd (desenvolvimento)
set -euo pipefail
ROOT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export REMOTE_CONFIG="\$ROOT_DIR/config/remote_config.yaml"
"\$ROOT_DIR/.venv/bin/uvicorn" backend.app.main:app \\
    --host 0.0.0.0 --port 8000 \\
    --ssl-certfile "\$ROOT_DIR/certs/cert.pem" \\
    --ssl-keyfile  "\$ROOT_DIR/certs/key.pem" \\
    --reload
EOF
  chmod +x "$run_sh"
  ok "Script de arranque criado: ./run.sh"
}

# ── sumário final ──────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}  4ham Remote Operation — instalação concluída${RESET}"
  echo -e "${BOLD}══════════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  ${BOLD}Config:${RESET}    $ROOT_DIR/config/remote_config.yaml"
  echo -e "  ${BOLD}Certs:${RESET}     $ROOT_DIR/certs/"
  echo -e "  ${BOLD}Logs inst:${RESET} $LOG_FILE"
  echo ""
  echo -e "  ${BOLD}Arranque rápido (dev):${RESET}"
  echo -e "    ${CYAN}./run.sh${RESET}"
  echo ""
  echo -e "  ${BOLD}Serviço systemd:${RESET}"
  echo -e "    ${CYAN}sudo systemctl start ${SERVICE_NAME}${RESET}"
  echo -e "    ${CYAN}journalctl -u ${SERVICE_NAME} -f${RESET}"
  echo ""
  echo -e "  ${YELLOW}Importante:${RESET} editar config/remote_config.yaml antes de iniciar."
  echo -e "  ${YELLOW}Password:${RESET}  python3 scripts/hash_password.py <password>"
  echo ""
}

# ── main ───────────────────────────────────────────────────────────────────────
main() {
  exec > >(tee -a "$LOG_FILE") 2>&1

  echo ""
  echo -e "${BOLD}════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  4ham Remote Operation — Installer     ${RESET}"
  echo -e "${BOLD}  CT7BFV — Octávio Filipe Pereira        ${RESET}"
  echo -e "${BOLD}════════════════════════════════════════${RESET}"
  echo ""

  check_os
  install_apt_deps
  install_wsjtx
  create_venv
  install_python_deps
  setup_config
  setup_certs
  create_run_script

  echo ""
  read -r -p "Instalar serviço systemd (requer sudo)? [s/N] " ans
  if [[ "${ans,,}" == "s" ]]; then
    install_systemd_service
  else
    info "Serviço systemd ignorado — usar ./run.sh para desenvolvimento."
  fi

  print_summary
}

main "$@"
