# 4ham Remote Operation — Localização Portuguesa (pt)
# ─────────────────────────────────────────────────────────────────────────────
# Para adicionar um novo idioma:
#   1. Copiar este ficheiro:  cp locales/pt.sh locales/XX.sh   (XX = ISO 639-1)
#   2. Definir LANG_CODE e LANG_NATIVE_NAME abaixo
#   3. Traduzir TODOS os valores (manter os nomes das variáveis inalterados)
#   4. Executar ./install.sh e seleccionar o novo idioma na lista
# ─────────────────────────────────────────────────────────────────────────────

LANG_CODE="pt"
LANG_NATIVE_NAME="Português"

# ── Título de fundo do instalador ──────────────────────────────────────────────
I18N_BT="4ham Remote Operation — Instalador"

# ── Etiquetas de botões ────────────────────────────────────────────────────────
I18N_BTN_EXIT_INSTALLER="Sair do Instalador"

# ── Compatibilidade de SO ──────────────────────────────────────────────────────
I18N_TITLE_OS_UNSUPPORTED="SO não suportado"
I18N_MSG_OS_UNSUPPORTED=$'Detectado: %OS% (%VER%)\n\nVersões mínimas suportadas:\n  Ubuntu 20.04+\n  Debian 11+\n  Linux Mint 20+\n  Raspberry Pi OS 11+\n\nO instalador não pode continuar neste sistema.'

# ── Python ─────────────────────────────────────────────────────────────────────
I18N_TITLE_PYTHON_MISSING="Python não encontrado"
I18N_MSG_PYTHON_MISSING=$'python3 não foi encontrado.\nInstalar primeiro: sudo apt install python3'
I18N_TITLE_PYTHON_VERSION="Versão de Python"
I18N_MSG_PYTHON_VERSION=$'É necessário Python 3.11 ou superior.\nDetectado: %VER%'

# ── Boas-vindas ────────────────────────────────────────────────────────────────
I18N_TITLE_WELCOME="Bem-vindo"
I18N_MSG_WELCOME=$'Bem-vindo ao instalador do 4ham Remote Operation!\n\nEste assistente irá:\n  1. Instalar dependências de sistema (Hamlib, FFmpeg, Opus, PortAudio, ...)\n  2. Instalar WSJT-X -- jt9/wsprd para FT8/FT4/WSPR (fase R3, opcional)\n  3. Criar o ambiente Python virtual (venv)\n  4. Instalar dependências Python (FastAPI, aiortc, sounddevice, ...)\n  5. Configurar o perfil do rádio (FT-991A ou Xiegu X6100)\n  6. Gerar certificados TLS para HTTPS (necessário para WebRTC)\n  7. Criar conta de operador (Basic Auth bcrypt)\n  8. Instalar serviço systemd (opcional)\n  9. Criar atalho no ambiente de trabalho\n\nPré-requisitos: acesso à internet e direitos sudo.\nSO detectado: %OS% -- suportado.\n\nPrima Enter para continuar.'

# ── Idioma da interface ────────────────────────────────────────────────────────
I18N_TITLE_UI_LANG="Idioma da Interface Web"
I18N_MSG_UI_LANG="Seleccione o idioma para a interface web:"
I18N_OPT_UI_EN="English"
I18N_OPT_UI_PT="Português"

# ── Perfil do rádio ────────────────────────────────────────────────────────────
I18N_TITLE_RADIO="Perfil do Rádio"
I18N_MSG_RADIO="Seleccione o rádio principal desta estação:"
I18N_OPT_FT991A="Yaesu FT-991A  (USB Serie -> rigctld, USB Audio 48kHz)"
I18N_OPT_X6100="Xiegu X6100    (WiFi/Ethernet nativo, IP configurável)"
I18N_LABEL_FT991A="Yaesu FT-991A"
I18N_LABEL_X6100="Xiegu X6100"
I18N_TITLE_X6100_IP="Xiegu X6100 -- Endereço IP"
I18N_MSG_X6100_IP="Endereço IP do X6100 na rede local:"

# ── WSJT-X ─────────────────────────────────────────────────────────────────────
I18N_TITLE_WSJTX_FOUND="WSJT-X -- Já instalado"
I18N_MSG_WSJTX_FOUND=$'jt9 e wsprd já estão instalados neste sistema.\n\nNão é necessário reinstalar -- a instalação continua.'
I18N_LABEL_WSJTX_FOUND="Já instalado (jt9 + wsprd detectados)"

I18N_TITLE_WSJTX_PARTIAL="WSJT-X -- Instalação incompleta"
I18N_MSG_WSJTX_PARTIAL_JT9=$'jt9 foi encontrado mas wsprd não está instalado.\nSera efectuada uma instalação completa do wsjtx para corrigir.'
I18N_MSG_WSJTX_PARTIAL_WSPRD=$'wsprd foi encontrado mas jt9 não está instalado.\nSera efectuada uma instalação completa do wsjtx para corrigir.'
I18N_LABEL_WSJTX_FIX="Sim (wsjtx -- a corrigir instalação incompleta)"

I18N_TITLE_WSJTX_ASK="WSJT-X -- Modos Digitais (Fase R3)"
I18N_MSG_WSJTX_ASK=$'Instalar WSJT-X (jt9 + wsprd)?\n\nNecessário para descodificação de FT8, FT4 e WSPR (fase R3).\nNão necessário para a fase R1 (RX áudio) nem R2 (TX SSB).\n\n  SIM  ->  sudo apt install wsjtx  (~50 MB)\n  NÃO  ->  ignorar por agora'
I18N_LABEL_WSJTX_YES="Sim (wsjtx -- jt9 + wsprd)"
I18N_LABEL_WSJTX_NO="Não (instalar depois para FT8/FT4/WSPR)"

# ── Modo de instalação ─────────────────────────────────────────────────────────
I18N_TITLE_INSTALL_MODE="Modo de Instalação"
I18N_MSG_INSTALL_MODE="Como pretende correr o 4ham Remote Operation?"
I18N_OPT_SYSTEMD="Serviço systemd -- arranque automático com o sistema (recomendado)"
I18N_OPT_MANUAL="Arranque manual pelo utilizador -- usar scripts/4ham_control.sh"
I18N_LABEL_SYSTEMD="Serviço systemd (arranque automático)"
I18N_LABEL_MANUAL="Arranque manual (scripts/4ham_control.sh)"

# ── Conta de operador ──────────────────────────────────────────────────────────
I18N_TITLE_OP_USER="Conta de Operador -- Utilizador"
I18N_MSG_OP_USER="Nome de utilizador para acesso à interface web:"
I18N_TITLE_OP_PASS="Conta de Operador -- Password"
I18N_MSG_OP_PASS="Password para '%USER%':"
I18N_TITLE_OP_PASS2="Conta de Operador -- Confirmar Password"
I18N_MSG_OP_PASS2="Confirmar password:"
I18N_TITLE_WEAK_PASS="Password Fraca"
I18N_MSG_WEAK_PASS=$'A password tem menos de 8 caracteres.\nContinuar mesmo assim?'
I18N_TITLE_ERR="Erro"
I18N_MSG_ERR_USER_EMPTY="O nome de utilizador não pode ser vazio."
I18N_MSG_ERR_PASS_EMPTY="A password não pode ser vazia."
I18N_MSG_ERR_PASS_MISMATCH="As passwords não coincidem. Tente novamente."

# ── Confirmação ────────────────────────────────────────────────────────────────
I18N_TITLE_CONFIRM="Confirmar Instalação"
I18N_MSG_CONFIRM=$'Pronto para instalar. Resumo:\n\n  SO              : %OS%\n  Rádio           : %RADIO%\n  Espectro RF     : %RTLSDR%\n  WSJT-X (R3)     : %WSJTX%\n  Modo instalação : %MODE%\n  Utilizador      : %USER%\n  Idioma interface: %UILANG%\n  Log             : %LOG%\n\nProsseguir com a instalação?'

# ── Passos da barra de progresso ───────────────────────────────────────────────
I18N_GAUGE_TITLE="A instalar 4ham Remote Operation -- aguarde..."
I18N_GAUGE_APT_UPDATE="A actualizar a lista de pacotes..."
I18N_GAUGE_APT_DEPS="A instalar dependências de sistema..."
I18N_GAUGE_WSJTX="A instalar WSJT-X (jt9 + wsprd)..."
I18N_GAUGE_VENV="A criar ambiente Python virtual..."
I18N_GAUGE_PIP="A instalar dependências Python (FastAPI, aiortc, sounddevice, ...)..."
I18N_GAUGE_RADIO_CFG="A configurar perfil do rádio..."
I18N_GAUGE_CERTS="A gerar certificados TLS (CA local + cert servidor)..."
I18N_GAUGE_CREDS="A guardar credenciais do operador..."
I18N_GAUGE_RUNSH="A preparar scripts de controlo do servidor..."
I18N_GAUGE_DIALOUT="A adicionar utilizador ao grupo dialout (acesso à porta série)..."
I18N_GAUGE_AUDIO_DETECT="A detectar dispositivo de áudio USB..."
I18N_GAUGE_RTLSDR="A instalar driver RTL-SDR e pyrtlsdr..."
I18N_GAUGE_RTLSDR_V4="A compilar driver RTL-SDR Blog v4..."
I18N_GAUGE_SYSTEMD="A instalar serviço systemd..."

# ── Erro fatal ─────────────────────────────────────────────────────────────────
I18N_TITLE_ABORT="Erro na Instalação"
I18N_MSG_ABORT=$'Ocorreu um erro durante a instalação.\n\nDetalhe: %DETAIL%\n\nLog completo:\n  %LOG%'

# ── Atalho no ambiente de trabalho ────────────────────────────────────────────
I18N_TITLE_DESKTOP="Atalho no Ambiente de Trabalho"
I18N_MSG_DESKTOP=$'Criar um atalho no ambiente de trabalho para o 4ham Remote Operation?\n\nUm lançador será adicionado ao ambiente de trabalho com opções para:\n  - Iniciar / Parar / Reiniciar o servidor\n  - Ver estado e registos em directo\n  - Abrir a interface web no browser'
I18N_DESKTOP_APP_NAME="4ham Remote Operation"
I18N_DESKTOP_COMMENT="Servidor de operação remota de rádio amador -- CT7BFV"

# ── Lançador (menu do atalho) ──────────────────────────────────────────────────
I18N_BT_LAUNCHER="4ham Remote Operation"
I18N_TITLE_LAUNCHER="4ham Remote Operation"
I18N_MSG_LAUNCHER="Seleccione uma acção:"
I18N_OPT_L_START="Iniciar servidor"
I18N_OPT_L_STOP="Parar servidor"
I18N_OPT_L_RESTART="Reiniciar servidor"
I18N_OPT_L_STATUS="Ver estado"
I18N_OPT_L_LOGS="Ver registos em directo  (Ctrl+C para sair)"
I18N_OPT_L_BROWSER="Abrir no browser"
I18N_OPT_L_EXIT="Sair"

# ── Conclusão ──────────────────────────────────────────────────────────────────
I18N_TITLE_DONE="Instalação Concluída!"
I18N_MSG_DONE_SYSTEMD=$'4ham Remote Operation instalado e em execução!\n\n[!] CONFIGURAÇÃO INICIAL -- fazer uma vez por dispositivo/browser:\n\n  1. Descarregar o certificado CA (HTTP simples, sem aviso):\n       http://%IP%:8002/4ham-local-ca.pem\n\n  2. Instalar a CA:\n       Windows : duplo-clique -> Autoridades de Raiz Fidedignas\n       Linux   : sudo cp 4ham-local-ca.pem /usr/local/share/ca-certificates/4ham-ca.crt\n                 sudo update-ca-certificates\n       macOS   : Keychain -> duplo-clique -> Confiar sempre\n       Firefox : Definições -> Privacidade -> Ver Certificados -> Importar\n\n  3. Abrir no browser (sem aviso após instalar a CA):\n       https://%IP%:8001/\n\nLogin:\n  Utilizador : %USER%\n  Password   : (a que definiu)\n\nServiço: sudo systemctl status|stop|restart %SVC%\nLog de instalação: %LOG%%WSJTX_NOTE%'
I18N_MSG_DONE_MANUAL=$'4ham Remote Operation instalado (modo manual).\n\n  Iniciar: scripts/4ham_control.sh start\n\n[!] CONFIGURAÇÃO INICIAL -- fazer uma vez por dispositivo/browser:\n\n  1. Descarregar o certificado CA (HTTP simples, sem aviso):\n       http://%IP%:8002/4ham-local-ca.pem\n\n  2. Instalar a CA:\n       Windows : duplo-clique -> Autoridades de Raiz Fidedignas\n       Linux   : sudo cp 4ham-local-ca.pem /usr/local/share/ca-certificates/4ham-ca.crt\n                 sudo update-ca-certificates\n       macOS   : Keychain -> duplo-clique -> Confiar sempre\n       Firefox : Definições -> Privacidade -> Ver Certificados -> Importar\n\n  3. Abrir no browser (sem aviso após instalar a CA):\n       https://%IP%:8001/\n\nLogin:\n  Utilizador : %USER%\n  Password   : (a que definiu)\n\nLog de instalação: %LOG%%WSJTX_NOTE%'
I18N_MSG_WSJTX_NOTE=$'\n\n  Nota: WSJT-X não instalado. Para activar FT8/WSPR mais tarde: sudo apt install wsjtx'
