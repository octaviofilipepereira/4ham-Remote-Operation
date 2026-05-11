# 4ham Remote Operation

> 🇵🇹 [Versão em Português](README.pt.md)

**Full browser-based remote operation of an amateur radio station.**

Controls a transceiver (Yaesu FT-991A, Xiegu X6100, or any Hamlib-supported radio) from any modern browser, featuring:

- Real-time bidirectional RX/TX audio (WebRTC Opus, <80 ms LAN)
- Full CAT control (frequency, mode, PTT, S-meter)
- Digital modes: FT8, FT4, live CW decode
- APRS via Direwolf/TNC
- Real-time AF waterfall in the browser
- Secure authentication (Basic Auth bcrypt)
- QSO logging in SQLite

## Development and test radios

| Radio | Hamlib model | Connection | Audio |
|---|---|---|---|
| Yaesu FT-991A | 1035 (`FT-991`) | USB Serial → rigctld :4532 | USB Audio 48 kHz (L=RX, R=TX) |
| Xiegu X6100 | 3087 (`X6100`) | Native WiFi/Ethernet | Native network (no USB) |

## Tech stack

| Component | Technology |
|---|---|
| Backend | FastAPI + asyncio (Python 3.11+) |
| Browser↔radio audio | aiortc (WebRTC, Opus 48 kHz) |
| AF audio (Linux) | sounddevice |
| AF audio (Windows) | audio_bridge.py (TCP socket) |
| CAT control | rigctld TCP (Hamlib 4.7.1) |
| Digital modes | jt9/WSJT-X subprocess + 4ham decoders |
| CW decode | CWDecoder NumPy/SciPy (4ham) |
| Frontend | HTML5 + Vanilla JS |
| Containerisation | Docker + docker-compose |

## Relationship with 4ham-spectrum-analysis

This project extensively reuses modules from 4ham:

- `decoders/cw/` → live CW decode
- `decoders/ft_external.py`, `ft_pipeline.py`, `ft_sync.py` → FT8/FT4
- `decoders/aprs_parser.py`, `aprs_is.py`, `direwolf_kiss.py` → APRS
- `decoders/ssb_asr.py` → SSB transcription via speech recognition
- `dsp/pipeline.py` → AF waterfall, mode classification
- `streaming.py` → delta FFT compression for WebSocket
- `core/auth.py` → bcrypt authentication
- `storage/db.py` → QSO logging SQLite
- `config/loader.py` → YAML/JSON configuration loader

## Project structure

```
4ham-Remote-Operation/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + WebRTC + WebSocket
│   │   ├── remote/              # New code: CAT, PTT, audio I/O, WebRTC
│   │   │   ├── cat_driver.py    # rigctld TCP client
│   │   │   ├── profiles/        # Per-radio profiles (ft991a.py, x6100.py)
│   │   │   ├── audio_rx.py      # sounddevice → WebRTC AudioTrack
│   │   │   ├── audio_tx.py      # WebRTC AudioTrack → sounddevice
│   │   │   └── webrtc_peer.py   # aiortc RTCPeerConnection
│   │   ├── api/                 # REST endpoints (CAT, WebRTC offer/answer)
│   │   ├── decoders/            # Ported from 4ham
│   │   ├── dsp/                 # Ported from 4ham
│   │   ├── core/                # Ported from 4ham (auth, storage)
│   │   ├── storage/             # Ported from 4ham (db.py)
│   │   ├── config/              # Ported from 4ham (loader.py)
│   │   └── streaming.py         # Ported from 4ham
│   └── requirements.txt
├── frontend/                    # HTML5 + JS (new)
├── audio_bridge/                # Windows: sounddevice capture → TCP socket
│   └── audio_bridge.py
├── config/
│   ├── radio_profiles.yaml
│   └── remote_config.yaml
├── Dockerfile
├── docker-compose.yml
├── install.sh                   # Linux installer
├── install.ps1                  # Windows installer
├── ROADMAP.md
├── ARCHITECTURE.md
└── DEV_PLAN.md
```

## Documentation

- [ROADMAP.md](ROADMAP.md) — Development phases R1 to R4
- [ARCHITECTURE.md](ARCHITECTURE.md) — Detailed technical architecture
- [DEV_PLAN.md](DEV_PLAN.md) — Development plan with tasks

## Licence

GNU General Public License v3.0 — same as 4ham-spectrum-analysis.

## Callsign

CT7BFV — Octávio Filipe Pereira
