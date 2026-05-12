<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-13 UTC
-->

# 4HAM Remote Operation — Hardware Requirements

> 🇵🇹 Este documento está em inglês por ser principalmente dirigido a quem instala o sistema.

---

## Table of Contents

1. [Minimum Setup](#1-minimum-setup)
2. [Supported Transceivers](#2-supported-transceivers)
3. [USB Audio (AF Interface)](#3-usb-audio-af-interface)
4. [CAT Interface (rigctld)](#4-cat-interface-rigctld)
5. [RTL-SDR (Wideband RF Spectrum)](#5-rtl-sdr-wideband-rf-spectrum)
6. [Server Hardware](#6-server-hardware)
7. [Network Requirements](#7-network-requirements)

---

## 1. Minimum Setup

The minimum hardware required to run 4HAM Remote Operation:

| Component | Purpose | Example |
|---|---|---|
| Transceiver | The radio being operated | Yaesu FT-991A |
| USB CAT interface | Frequency/mode/PTT control | FT-991A USB port → `/dev/ttyUSB0` |
| USB Audio interface | RX/TX audio stream | FT-991A PCM2903B (USB Audio CODEC) |
| Server / PC | Runs backend + rigctld | Linux x86-64, connected to radio via USB |
| Network | Connects server to operator's browser | LAN or Internet with port 8000 open |

Optional but recommended:

| Component | Purpose |
|---|---|
| RTL-SDR dongle | Wideband RF spectrum (±50 kHz panadapter) |
| SSL certificate | Secure HTTPS (self-signed works) |
| Static IP / DDNS | Stable remote access address |

---

## 2. Supported Transceivers

Any transceiver supported by [Hamlib](https://hamlib.github.io/) can be used for CAT control (frequency, mode, PTT).

Transceivers tested or documented for 4HAM Remote Operation:

| Transceiver | Hamlib model | CAT port | Audio | Notes |
|---|---|---|---|---|
| **Yaesu FT-991A** | 1035 | USB Serial `/dev/ttyUSB0`, 38400 baud | USB Audio CODEC (PCM2903B) — L=RX, R=TX | Primary development radio |
| **Xiegu X6100** | 3087 | Network (native WiFi/Ethernet) | Network audio (native) | No USB required |
| **Icom IC-7300** | 373 | USB Serial, 19200 baud | USB Audio — IQ output available | IQ output enables wideband spectrum without RTL-SDR |
| **Yaesu FTDX10** | 1118 | USB Serial, 38400 baud | USB Audio | Has built-in scope — future SDR interface possible |
| **Elecraft K4** | 2050 | Network or USB Serial | Network or USB Audio | Native network CAT |

> For full Hamlib model list: `rigctl -l | grep <brand>`

### Transceivers with native wideband spectrum

Some transceivers provide IQ or scope data over USB without needing an RTL-SDR:

| Transceiver | Interface | Span |
|---|---|---|
| Icom IC-7300, IC-7610 | USB IQ output | ±48 kHz |
| Yaesu FTDX10, FTDX101 | USB scope data | ±50 kHz |
| Elecraft K4 | Network audio/IQ | Configurable |
| Xiegu X6100 | Network native | Built-in scope |

> **FT-991A note:** The FT-991A does **not** provide IQ or wideband spectrum data over USB. The USB Audio output is demodulated AF only (0–3 kHz for SSB). Without an RTL-SDR, the waterfall shows AF spectrum (0–3 kHz); an RTL-SDR dongle is **optional** and enables a wideband panadapter (±50 kHz centred on the VFO).

---

## 3. USB Audio (AF Interface)

4HAM Remote Operation captures RX audio and sends TX audio via a Linux ALSA sound device connected to the transceiver.

### FT-991A (PCM2903B)

The FT-991A exposes a USB Audio Codec (Texas Instruments PCM2903B) when connected via USB.

| Parameter | Value |
|---|---|
| USB VID:PID | `08bb:29b3` |
| ALSA device name | `USB Audio CODEC` |
| Sample rate | 48000 Hz |
| RX channel | 0 (Left) |
| TX channel | 1 (Right) |
| rigctld baud | 38400 |

Detect after connecting USB:
```bash
aplay -l | grep USB
python3 -c "import sounddevice; print(sounddevice.query_devices())"
```

### Other radios

Any radio with a USB Audio interface (Icom IC-7300, Kenwood TS-890S, etc.) can be used. Set the `device` name in `config/remote_config.yaml` to match the ALSA device name reported by `sounddevice.query_devices()`.

---

## 4. CAT Interface (rigctld)

CAT control is provided by [Hamlib](https://hamlib.github.io/) via the `rigctld` TCP daemon.

4HAM Remote Operation connects to rigctld on `localhost:4532` using the **extended protocol** (all commands prefixed with `+`).

### Typical rigctld invocations

**FT-991A:**
```bash
rigctld -m 1035 -r /dev/ttyUSB0 -s 38400 -t 4532
```

**Icom IC-7300:**
```bash
rigctld -m 373 -r /dev/ttyUSB0 -s 19200 -t 4532
```

**Xiegu X6100 (network):**
```bash
rigctld -m 3087 -r <x6100-ip>:4532 -t 4532
```

See [radio_profiles.md](radio_profiles.md) for full per-radio configuration examples.

---

## 5. RTL-SDR (Wideband RF Spectrum) — Optional

> **The RTL-SDR is entirely optional.** Without it, 4HAM Remote Operation works normally; the waterfall displays AF spectrum (0–3 kHz). Adding an RTL-SDR upgrades the waterfall to a full RF panadapter (±50 kHz centred on the VFO), which is especially useful with radios that do not provide native wideband spectrum over USB (e.g. FT-991A).

An RTL-SDR dongle provides wideband RF spectrum (panadapter view) centred on the VFO frequency. The installer will ask whether you have one connected; if not, simply answer No and the system works with AF spectrum.

### Supported dongles

| Dongle | USB VID:PID | Notes |
|---|---|---|
| RTL-SDR Blog v3 | `0bda:2838` | Most common; supported by standard `rtl-sdr` apt package |
| RTL-SDR Blog v4 | `0bda:2838` | Requires custom driver from `rtlsdrblog/rtl-sdr-blog` |
| Generic RTL2832U | `0bda:2832` | Works; lower quality |

### Installation

Standard (v3 and generic):
```bash
sudo apt install rtl-sdr
```

RTL-SDR Blog v4:
```bash
sudo apt remove -y rtl-sdr librtlsdr0 librtlsdr-dev
git clone https://github.com/rtlsdrblog/rtl-sdr-blog
cd rtl-sdr-blog && mkdir build && cd build
cmake ../ -DINSTALL_UDEV_RULES=ON
make && sudo make install && sudo ldconfig
```

Blacklist conflicting kernel modules:
```bash
sudo tee /etc/modprobe.d/blacklist-rtl.conf <<'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
EOF
sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true
```

Test:
```bash
rtl_test -t
```

Python bindings (for backend integration):
```bash
pip install pyrtlsdr
```

---

## 6. Server Hardware

The server is the Linux machine physically connected to the transceiver, running the 4HAM backend.

### Minimum

| Component | Minimum |
|---|---|
| CPU | Dual-core, x86-64 or ARM64 |
| RAM | 512 MB |
| Storage | 1 GB free |
| OS | Ubuntu 22.04 / Debian 12 / Raspberry Pi OS 11+ (64-bit) |
| USB ports | 2× (one for CAT/Audio, one for RTL-SDR if used) |

### Recommended

| Component | Recommended |
|---|---|
| CPU | Quad-core, x86-64 |
| RAM | 2 GB+ |
| OS | Ubuntu 22.04 LTS |

### Reference server (CT7BFV installation)

| Component | Detail |
|---|---|
| Architecture | PC Linux x86-64 |
| USB CAT/Audio | CP2105 Dual UART → FT-991A `/dev/ttyUSB0` |
| USB Audio | PCM2903B `USB Audio CODEC` |
| RTL-SDR | RTL2838 `0bda:2838` (present, pending integration) |
| OS | Linux |

---

## 7. Network Requirements

### Ports

| Port | Protocol | Purpose |
|---|---|---|
| 8000 | HTTPS (TCP) | Main web interface + REST API + WebSocket + WebRTC signalling |
| 4532 | TCP | rigctld (localhost only — do NOT expose externally) |

> `rigctld` must **not** be exposed to the internet. It should only listen on `127.0.0.1`.

### Firewall

Open port 8000 only:
```bash
sudo ufw allow 8000/tcp
sudo ufw enable
```

### DDNS (optional)

For remote access without a static IP, use a DDNS service (e.g. DuckDNS, No-IP) and set your router to forward port 8000 to the server's LAN IP.

---

*See [radio_profiles.md](radio_profiles.md) for per-radio configuration details.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
