# 4ham Remote Operation — English locale (en)
# ─────────────────────────────────────────────────────────────────────────────
# To add a new language:
#   1. Copy this file:  cp locales/en.sh locales/XX.sh   (XX = ISO 639-1 code)
#   2. Set LANG_CODE and LANG_NATIVE_NAME below
#   3. Translate ALL values (keep variable names unchanged)
#   4. Run ./install.sh and select your language from the list
# ─────────────────────────────────────────────────────────────────────────────

LANG_CODE="en"
LANG_NATIVE_NAME="English"

# ── Installer backtitle ────────────────────────────────────────────────────────
I18N_BT="4ham Remote Operation — Installer"

# ── Button labels ──────────────────────────────────────────────────────────────
I18N_BTN_EXIT_INSTALLER="Exit Installer"

# ── OS compatibility ───────────────────────────────────────────────────────────
I18N_TITLE_OS_UNSUPPORTED="Unsupported OS"
I18N_MSG_OS_UNSUPPORTED=$'Detected: %OS% (%VER%)\n\nMinimum supported versions:\n  Ubuntu 20.04+\n  Debian 11+\n  Linux Mint 20+\n  Raspberry Pi OS 11+\n\nThe installer cannot continue on this system.'

# ── Python ─────────────────────────────────────────────────────────────────────
I18N_TITLE_PYTHON_MISSING="Python Not Found"
I18N_MSG_PYTHON_MISSING=$'python3 was not found.\nInstall it first: sudo apt install python3'
I18N_TITLE_PYTHON_VERSION="Python Version"
I18N_MSG_PYTHON_VERSION=$'Python 3.11 or later is required.\nFound: %VER%'

# ── Welcome ────────────────────────────────────────────────────────────────────
I18N_TITLE_WELCOME="Welcome"
I18N_MSG_WELCOME=$'Welcome to the 4ham Remote Operation installer!\n\nThis wizard will:\n  1. Install system packages (Hamlib, FFmpeg, Opus, PortAudio, ...)\n  2. Optionally install WSJT-X -- jt9/wsprd for FT8/FT4/WSPR (phase R3)\n  3. Create the Python virtual environment (venv)\n  4. Install Python dependencies (FastAPI, aiortc, sounddevice, ...)\n  5. Configure the radio profile (FT-991A or Xiegu X6100)\n  6. Generate TLS certificates for HTTPS (required for WebRTC)\n  7. Create operator account (Basic Auth bcrypt)\n  8. Optionally install a systemd service\n  9. Create desktop shortcut\n\nRequirements: internet access and sudo rights.\nDetected OS: %OS% -- supported.\n\nPress Enter to continue.'

# ── UI language ────────────────────────────────────────────────────────────────
I18N_TITLE_UI_LANG="Web Interface Language"
I18N_MSG_UI_LANG="Select the language for the web interface:"
I18N_OPT_UI_EN="English"
I18N_OPT_UI_PT="Português"

# ── Radio profile ──────────────────────────────────────────────────────────────
I18N_TITLE_RADIO="Radio Profile"
I18N_MSG_RADIO="Select the main radio for this station:"
I18N_OPT_FT991A="Yaesu FT-991A  (USB Serial -> rigctld, USB Audio 48kHz)"
I18N_OPT_X6100="Xiegu X6100    (WiFi/Ethernet native, configurable IP)"
I18N_LABEL_FT991A="Yaesu FT-991A"
I18N_LABEL_X6100="Xiegu X6100"
I18N_TITLE_X6100_IP="Xiegu X6100 -- IP Address"
I18N_MSG_X6100_IP="IP address of the X6100 on the local network:"

# ── WSJT-X ─────────────────────────────────────────────────────────────────────
I18N_TITLE_WSJTX_FOUND="WSJT-X -- Already Installed"
I18N_MSG_WSJTX_FOUND=$'jt9 and wsprd are already installed on this system.\n\nNo reinstallation needed -- continuing.'
I18N_LABEL_WSJTX_FOUND="Already installed (jt9 + wsprd detected)"

I18N_TITLE_WSJTX_PARTIAL="WSJT-X -- Partial Installation"
I18N_MSG_WSJTX_PARTIAL_JT9=$'jt9 was found but wsprd is not installed.\nA full wsjtx installation will be performed to fix this.'
I18N_MSG_WSJTX_PARTIAL_WSPRD=$'wsprd was found but jt9 is not installed.\nA full wsjtx installation will be performed to fix this.'
I18N_LABEL_WSJTX_FIX="Yes (wsjtx -- fixing incomplete installation)"

I18N_TITLE_WSJTX_ASK="WSJT-X -- Digital Modes (Phase R3)"
I18N_MSG_WSJTX_ASK=$'Install WSJT-X (jt9 + wsprd)?\n\nRequired for FT8, FT4 and WSPR decoding (phase R3).\nNot required for phase R1 (RX audio) or R2 (TX SSB).\n\n  YES  ->  sudo apt install wsjtx  (~50 MB)\n  NO   ->  skip for now'
I18N_LABEL_WSJTX_YES="Yes (wsjtx -- jt9 + wsprd)"
I18N_LABEL_WSJTX_NO="No (install later for FT8/FT4/WSPR)"

# ── Install mode ───────────────────────────────────────────────────────────────
I18N_TITLE_INSTALL_MODE="Installation Mode"
I18N_MSG_INSTALL_MODE="How do you want to run 4ham Remote Operation?"
I18N_OPT_SYSTEMD="systemd service -- auto-start on boot (recommended)"
I18N_OPT_MANUAL="Manual start/stop -- use scripts/4ham_control.sh"
I18N_LABEL_SYSTEMD="systemd service (auto-start on boot)"
I18N_LABEL_MANUAL="Manual start/stop (scripts/4ham_control.sh)"

# ── Operator account ───────────────────────────────────────────────────────────
I18N_TITLE_OP_USER="Operator Account -- Username"
I18N_MSG_OP_USER="Username for web interface access:"
I18N_TITLE_OP_PASS="Operator Account -- Password"
I18N_MSG_OP_PASS="Password for '%USER%':"
I18N_TITLE_OP_PASS2="Operator Account -- Confirm Password"
I18N_MSG_OP_PASS2="Confirm password:"
I18N_TITLE_WEAK_PASS="Weak Password"
I18N_MSG_WEAK_PASS=$'Password is shorter than 8 characters.\nContinue anyway?'
I18N_TITLE_ERR="Error"
I18N_MSG_ERR_USER_EMPTY="Username cannot be empty."
I18N_MSG_ERR_PASS_EMPTY="Password cannot be empty."
I18N_MSG_ERR_PASS_MISMATCH="Passwords do not match. Please try again."

# ── Confirmation ───────────────────────────────────────────────────────────────
I18N_TITLE_CONFIRM="Confirm Installation"
I18N_MSG_CONFIRM=$'Ready to install. Summary:\n\n  OS              : %OS%\n  Radio           : %RADIO%\n  RF Spectrum     : %RTLSDR%\n  WSJT-X (R3)     : %WSJTX%\n  Install mode    : %MODE%\n  Username        : %USER%\n  UI Language     : %UILANG%\n  Log             : %LOG%\n\nProceed with installation?'

# ── Gauge steps ────────────────────────────────────────────────────────────────
I18N_GAUGE_TITLE="Installing 4ham Remote Operation -- please wait..."
I18N_GAUGE_APT_UPDATE="Updating package lists..."
I18N_GAUGE_APT_DEPS="Installing system packages..."
I18N_GAUGE_WSJTX="Installing WSJT-X (jt9 + wsprd)..."
I18N_GAUGE_VENV="Creating Python virtual environment..."
I18N_GAUGE_PIP="Installing Python dependencies (FastAPI, aiortc, sounddevice, ...)..."
I18N_GAUGE_RADIO_CFG="Configuring radio profile..."
I18N_GAUGE_CERTS="Generating TLS certificates (local CA + server cert)..."
I18N_GAUGE_CREDS="Saving operator credentials..."
I18N_GAUGE_RUNSH="Preparing server control scripts..."
I18N_GAUGE_DIALOUT="Adding user to dialout group (serial port access)..."
I18N_GAUGE_AUDIO_DETECT="Detecting USB audio device..."
I18N_GAUGE_RTLSDR="Installing RTL-SDR driver and pyrtlsdr..."
I18N_GAUGE_RTLSDR_V4="Compiling RTL-SDR Blog v4 driver..."
I18N_GAUGE_SYSTEMD="Installing systemd service..."

# ── Abort ──────────────────────────────────────────────────────────────────────
I18N_TITLE_ABORT="Installation Failed"
I18N_MSG_ABORT=$'An error occurred during installation.\n\nDetail: %DETAIL%\n\nFull log:\n  %LOG%'

# ── Desktop shortcut ───────────────────────────────────────────────────────────
I18N_TITLE_DESKTOP="Desktop Shortcut"
I18N_MSG_DESKTOP=$'Create a desktop shortcut for 4ham Remote Operation?\n\nA launcher will be added to your desktop with options to:\n  - Start / Stop / Restart the server\n  - Show status and live logs\n  - Open the web interface in the browser'
I18N_DESKTOP_APP_NAME="4ham Remote Operation"
I18N_DESKTOP_COMMENT="Ham radio remote operation server -- CT7BFV"

# ── Launcher (desktop menu script) ────────────────────────────────────────────
I18N_BT_LAUNCHER="4ham Remote Operation"
I18N_TITLE_LAUNCHER="4ham Remote Operation"
I18N_MSG_LAUNCHER="Select action:"
I18N_OPT_L_START="Start server"
I18N_OPT_L_STOP="Stop server"
I18N_OPT_L_RESTART="Restart server"
I18N_OPT_L_STATUS="Show status"
I18N_OPT_L_LOGS="Show live logs  (Ctrl+C to exit)"
I18N_OPT_L_BROWSER="Open in browser"
I18N_OPT_L_EXIT="Exit"

# ── Completion ─────────────────────────────────────────────────────────────────
I18N_TITLE_DONE="Installation Complete!"
I18N_MSG_DONE_SYSTEMD=$'4ham Remote Operation is installed and running!\n\n[!] FIRST-TIME SETUP -- do this once per device/browser:\n\n  1. Download the CA certificate (plain HTTP, no warning):\n       http://%IP%:8002/4ham-local-ca.pem\n\n  2. Install the CA cert:\n       Windows : double-click -> Trusted Root CAs\n       Linux   : sudo cp 4ham-local-ca.pem /usr/local/share/ca-certificates/4ham-ca.crt\n                 sudo update-ca-certificates\n       macOS   : Keychain -> double-click -> Trust always\n       Firefox : Settings -> Privacy -> View Certs -> Import\n\n  3. Open in browser (no warning after CA install):\n       https://%IP%:8001/\n\nLogin:\n  Username : %USER%\n  Password : (the one you set)\n\nService: sudo systemctl status|stop|restart %SVC%\nInstall log: %LOG%%WSJTX_NOTE%'
I18N_MSG_DONE_MANUAL=$'4ham Remote Operation is installed (manual mode).\n\n  Start server: scripts/4ham_control.sh start\n\n[!] FIRST-TIME SETUP -- do this once per device/browser:\n\n  1. Download the CA certificate (plain HTTP, no warning):\n       http://%IP%:8002/4ham-local-ca.pem\n\n  2. Install the CA cert:\n       Windows : double-click -> Trusted Root CAs\n       Linux   : sudo cp 4ham-local-ca.pem /usr/local/share/ca-certificates/4ham-ca.crt\n                 sudo update-ca-certificates\n       macOS   : Keychain -> double-click -> Trust always\n       Firefox : Settings -> Privacy -> View Certs -> Import\n\n  3. Open in browser (no warning after CA install):\n       https://%IP%:8001/\n\nLogin:\n  Username : %USER%\n  Password : (the one you set)\n\nInstall log: %LOG%%WSJTX_NOTE%'
I18N_MSG_WSJTX_NOTE=$'\n\n  Note: WSJT-X not installed. To enable FT8/WSPR later: sudo apt install wsjtx'
