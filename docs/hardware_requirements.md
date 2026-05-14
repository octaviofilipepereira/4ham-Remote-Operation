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
5. [Server Hardware](#5-server-hardware)
6. [Network Requirements](#6-network-requirements)

---

## 1. Minimum Setup

The minimum hardware required to run 4HAM Remote Operation:

| Component | Purpose | Example |
|---|---|---|
| Transceiver | The radio being operated | Yaesu FT-991A |
| USB CAT interface | Frequency/mode/PTT control | FT-991A USB port → `/dev/ttyUSB0` |
| USB Audio interface | RX/TX audio stream | FT-991A PCM2903B (USB Audio CODEC) |
| Server / PC | Runs backend + rigctld | Linux x86-64, connected to radio via USB |
| Network | Connects server to operator's browser | LAN or Internet with port 8001 open |

Optional but recommended:

| Component | Purpose |
|---|---|
| SSL certificate | Secure HTTPS (self-signed works) |
| Static IP / DDNS | Stable remote access address |

---

## 2. Supported Transceivers

Any transceiver supported by [Hamlib](https://hamlib.github.io/) can be used for CAT control (frequency, mode, PTT).

Transceivers tested or documented for 4HAM Remote Operation:

| Transceiver | Hamlib model | CAT port | Audio | Notes |
|---|---|---|---|---|
| **Yaesu FT-991A** | 1035 | USB Serial `/dev/ttyUSB0`, 38400 baud | USB Audio CODEC (PCM2903B) — L=RX, R=TX | Primary development radio |
| **Xiegu X6100** | 3087 | Network (native WiFi/Ethernet) | Network audio (native) | **No USB** — CAT and audio are network-only |
| **Icom IC-7300** | 373 | USB Serial, 19200 baud | USB Audio — IQ output available | IQ output enables native wideband spectrum |
| **Yaesu FTDX10** | 1118 | USB Serial, 38400 baud | USB Audio | Has built-in scope — future SDR interface possible |
| **Elecraft K4** | 2050 | Network or USB Serial | Network or USB Audio | Native network CAT |

> For full Hamlib model list: `rigctl -l | grep <brand>`

### Transceivers with native wideband spectrum

Some transceivers provide IQ or scope data over USB, enabling a wideband panadapter view:

| Transceiver | Interface | Span |
|---|---|---|
| Icom IC-7300, IC-7610 | USB IQ output | ±48 kHz |
| Yaesu FTDX10, FTDX101 | USB scope data | ±50 kHz |
| Elecraft K4 | Network audio/IQ | Configurable |
| Xiegu X6100 | Network native | Built-in scope (physical display only — network spectrum API not yet integrated in 4HAM) |

> **FT-991A note:** The FT-991A does **not** provide IQ or wideband spectrum data over USB. The USB Audio output is demodulated AF only (0–3 kHz for SSB). The waterfall shows AF spectrum (0–3 kHz).

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

## 5. Server Hardware

The server is the Linux machine physically connected to the transceiver, running the 4HAM backend.

### Minimum

| Component | Minimum |
|---|---|
| CPU | Dual-core, x86-64 or ARM64 |
| RAM | 512 MB |
| Storage | 1 GB free |
| OS | Ubuntu 22.04 / Debian 12 / Raspberry Pi OS 11+ (64-bit) |
| USB ports | 1× (CAT/Audio) |

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
| OS | Linux |

---

## 6. Network Requirements

### Ports

| Port | Protocol | Purpose |
|---|---|---|
| 8001 | HTTPS (TCP) | Main web interface + REST API + WebSocket + WebRTC signalling |
| 4532 | TCP | rigctld (localhost only — do NOT expose externally) |

> `rigctld` must **not** be exposed to the internet. It should only listen on `127.0.0.1`.

### Firewall

Open port 8001 only:
```bash
sudo ufw allow 8001/tcp
sudo ufw enable
```

### DDNS (optional)

For remote access without a static IP, use a DDNS service (e.g. DuckDNS, No-IP) and set your router to forward port 8001 to the server's LAN IP.

---

*See [radio_profiles.md](radio_profiles.md) for per-radio configuration details.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
