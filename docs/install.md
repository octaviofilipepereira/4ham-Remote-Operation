<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-13 UTC
-->

# 4HAM Remote Operation — Installation Guide

> For a full step-by-step manual, see [installation_manual.md](installation_manual.md).  
> For supported hardware, see [hardware_requirements.md](hardware_requirements.md).

---

## Quick Start

```bash
git clone https://github.com/octaviofilipepereira/4ham-Remote-Operation.git
cd 4ham-Remote-Operation
chmod +x install.sh && ./install.sh
```

The installer configures: system packages, Python virtual environment, SSL certificates, system user permissions, and the configuration file template.

After installation, open the URL printed by the installer and log in.

---

## Requirements

| Component | Requirement |
|---|---|
| OS | Linux (Ubuntu 22.04+ / Debian 12+ recommended) |
| Python | 3.11+ |
| Hamlib / rigctld | 4.5+ |
| RAM | 512 MB minimum, 1 GB recommended |
| CPU | x86-64 or ARM64 |
| Network | Static IP or DDNS recommended for remote access |

---

## Manual Installation

### 1. System packages

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip \
    hamlib-utils usbutils git openssl
```

For USB Audio (FT-991A and similar):
```bash
sudo apt install -y alsa-utils
sudo usermod -aG dialout,audio $USER
```

Log out and back in for group changes to take effect.

### 2. Clone repository

```bash
git clone https://github.com/octaviofilipepereira/4ham-Remote-Operation.git
cd 4ham-Remote-Operation
```

### 3. Python virtual environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 4. SSL certificates

For production (self-signed):
```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem \
    -out certs/cert.pem -days 3650 -nodes \
    -subj "/CN=4ham-remote"
```

### 5. Configuration

```bash
cp config/remote_config.example.yaml config/remote_config.yaml
```

Edit `config/remote_config.yaml` and set at minimum:

```yaml
auth:
  username: <your_username>
  password_hash: <bcrypt_hash>   # generate with: python -c "import bcrypt; print(bcrypt.hashpw(b'yourpass', bcrypt.gensalt()).decode())"

rig:
  model: 1035                     # FT-991A
  port: /dev/ttyUSB0
  baud: 38400

audio:
  device: "USB Audio CODEC"       # USB Audio CODEC name (run: python -m sounddevice)
  rx_channel: 0
  tx_channel: 1
```

> `config/remote_config.yaml` is **not** tracked by git — it stays local on the server.

### 6. Start rigctld

```bash
rigctld -m 1035 -r /dev/ttyUSB0 -s 38400 -t 4532 &
```

Adapt `-m` and `-r` for your radio. See [radio_profiles.md](radio_profiles.md).

### 7. Start the backend

```bash
REMOTE_CONFIG=config/remote_config.yaml \
  .venv/bin/uvicorn backend.app.main:app \
  --host 0.0.0.0 --port 8001 \
  --ssl-certfile certs/cert.pem \
  --ssl-keyfile certs/key.pem
```

Open `https://<server-ip>:8001/` in a browser and log in.

---

## Production Service (systemd)

```bash
sudo cp scripts/4ham-remote.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 4ham-remote
```

Service operations:

```bash
sudo systemctl start 4ham-remote
sudo systemctl stop 4ham-remote
sudo systemctl restart 4ham-remote
sudo systemctl status 4ham-remote
journalctl -u 4ham-remote -n 50
```

---

## Uninstallation

To remove the service (keeping project files):
```bash
sudo systemctl disable --now 4ham-remote
sudo rm /etc/systemd/system/4ham-remote.service
sudo systemctl daemon-reload
```

To remove everything:
```bash
cd ..
rm -rf 4ham-Remote-Operation
```

---

## Troubleshooting

### rigctld not found
```bash
sudo apt install hamlib-utils
# verify:
rigctld --version
```

### USB Audio device not found

List available audio devices:
```bash
python3 -c "import sounddevice; print(sounddevice.query_devices())"
```

Use the exact device name string in `config/remote_config.yaml`.

### Permission denied on /dev/ttyUSB0

```bash
sudo usermod -aG dialout $USER
# log out and back in, then verify:
groups | grep dialout
```

### Backend fails to start (port 8001 in use)

```bash
fuser -k 8001/tcp
```

---

*See [hardware_requirements.md](hardware_requirements.md) for supported radios and hardware setup.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
