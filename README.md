# 4ham Remote Operation

**Operação remota completa de estação de rádio amador via browser.**

Permite controlar um transceptor (Yaesu FT-991A, Xiegu X6100 ou qualquer rádio suportado pelo Hamlib) a partir de qualquer browser moderno, com:

- Áudio RX/TX bidirecional em tempo real (WebRTC Opus, <80ms LAN)
- Controlo CAT completo (frequência, modo, PTT, S-meter)
- Modos digitais: FT8, FT4, CW decode ao vivo
- APRS via Direwolf/TNC
- Waterfall AF em tempo real no browser
- Autenticação segura (Basic Auth bcrypt)
- Logging de QSOs em SQLite

## Rádios de desenvolvimento e teste

| Rádio | Hamlib modelo | Ligação | Áudio |
|---|---|---|---|
| Yaesu FT-991A | 1035 (`FT-991`) | USB Serial → rigctld :4532 | USB Audio 48kHz (L=RX, R=TX) |
| Xiegu X6100 | 3087 (`X6100`) | WiFi/Ethernet nativo | Rede nativa (sem USB) |

## Stack técnica

| Componente | Tecnologia |
|---|---|
| Backend | FastAPI + asyncio (Python 3.11+) |
| Áudio browser↔rádio | aiortc (WebRTC, Opus 48kHz) |
| Áudio AF (Linux) | sounddevice |
| Áudio AF (Windows) | audio_bridge.py (socket TCP) |
| Controlo CAT | rigctld TCP (Hamlib 4.7.1) |
| Modos digitais | jt9/WSJT-X subprocess + decoders 4ham |
| CW decode | CWDecoder NumPy/SciPy (4ham) |
| Frontend | HTML5 + Vanilla JS |
| Containerização | Docker + docker-compose |

## Relação com o 4ham-spectrum-analysis

Este projecto reutiliza extensamente módulos do 4ham:

- `decoders/cw/` → CW decode ao vivo
- `decoders/ft_external.py`, `ft_pipeline.py`, `ft_sync.py` → FT8/FT4
- `decoders/aprs_parser.py`, `aprs_is.py`, `direwolf_kiss.py` → APRS
- `decoders/ssb_asr.py` → transcrição SSB por reconhecimento de voz
- `dsp/pipeline.py` → waterfall AF, classificação de modo
- `streaming.py` → compressão delta FFT para WebSocket
- `core/auth.py` → autenticação bcrypt
- `storage/db.py` → logging QSOs SQLite
- `config/loader.py` → carregamento de configuração YAML/JSON

## Estrutura do projecto

```
4ham-Remote-Operation/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + WebRTC + WebSocket
│   │   ├── remote/              # Código novo: CAT, PTT, audio I/O, WebRTC
│   │   │   ├── cat_driver.py    # rigctld TCP client
│   │   │   ├── profiles/        # Perfis por rádio (ft991a.py, x6100.py)
│   │   │   ├── audio_rx.py      # sounddevice → WebRTC AudioTrack
│   │   │   ├── audio_tx.py      # WebRTC AudioTrack → sounddevice
│   │   │   └── webrtc_peer.py   # aiortc RTCPeerConnection
│   │   ├── api/                 # REST endpoints (CAT, WebRTC offer/answer)
│   │   ├── decoders/            # Copiado do 4ham
│   │   ├── dsp/                 # Copiado do 4ham
│   │   ├── core/                # Copiado do 4ham (auth, storage)
│   │   ├── storage/             # Copiado do 4ham (db.py)
│   │   ├── config/              # Copiado do 4ham (loader.py)
│   │   └── streaming.py         # Copiado do 4ham
│   └── requirements.txt
├── frontend/                    # HTML5 + JS (novo)
├── audio_bridge/                # Windows: captura sounddevice → socket TCP
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

## Documentação

- [ROADMAP.md](ROADMAP.md) — Fases de desenvolvimento R1 a R4
- [ARCHITECTURE.md](ARCHITECTURE.md) — Arquitectura técnica detalhada
- [DEV_PLAN.md](DEV_PLAN.md) — Plano de desenvolvimento com tarefas

## Licença

GNU General Public License v3.0 — mesmo que o 4ham-spectrum-analysis.

## Indicativo

CT7BFV — Octávio Filipe Pereira
