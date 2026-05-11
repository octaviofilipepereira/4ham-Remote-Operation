# ARCHITECTURE — 4ham Remote Operation

**Versão**: 0.1 (Maio 2026)  
**Autor**: CT7BFV — Octávio Filipe Pereira

---

## Visão geral

O 4ham Remote Operation é um servidor Python (FastAPI) que interliga um transceptor físico ao browser do operador remoto através de três canais:

1. **Áudio bidirecional** — WebRTC Opus (aiortc) para RX e TX em tempo real
2. **Controlo CAT** — REST API sobre rigctld TCP (Hamlib) para frequência, modo, PTT
3. **Dados em tempo real** — WebSocket para waterfall AF, decodes FT8/CW, eventos APRS

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (operador remoto)                │
│                                                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │  WebRTC RX   │  │  REST API     │  │  WebSocket          │  │
│  │  (ouvir)     │  │  (freq/mode/  │  │  (waterfall, FT8,   │  │
│  │  WebRTC TX   │  │   PTT)        │  │   CW, APRS, events) │  │
│  │  (microfone) │  └───────────────┘  └─────────────────────┘  │
│  └──────────────┘                                               │
└────────────┬────────────────────┬──────────────────────────────┘
             │ WebRTC (DTLS/SRTP) │ HTTPS/WSS
             │                   │
┌────────────▼───────────────────▼──────────────────────────────┐
│                    4ham Remote Backend (Python)                │
│                                                                │
│  FastAPI + uvicorn + asyncio                                   │
│                                                                │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  WebRTC Layer   │  │  CAT Driver      │  │  Decoders    │  │
│  │  (aiortc)       │  │  (rigctld TCP)   │  │  (4ham)      │  │
│  │                 │  │                  │  │              │  │
│  │  audio_rx.py    │  │  cat_driver.py   │  │  ft_external │  │
│  │  audio_tx.py    │  │  profiles/       │  │  cw_session  │  │
│  │  webrtc_peer.py │  │                  │  │  aprs_parser │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                   │                    │          │
│  ┌────────▼────────┐  ┌───────▼─────────┐         │          │
│  │  Audio I/O      │  │  rigctld daemon  │         │          │
│  │  sounddevice    │  │  (Hamlib 4.7.1)  │         │          │
│  └────────┬────────┘  └───────┬─────────┘         │          │
└───────────┼───────────────────┼───────────────────┼──────────┘
            │                   │ TCP :4532          │
            │ USB Audio         │                   │ AF audio
┌───────────▼───────────────────▼───────────────────▼──────────┐
│                    TRANSCEPTOR (hardware)                     │
│                                                               │
│  Yaesu FT-991A  ←→  USB Serial (CAT) + USB Audio (AF)        │
│  Xiegu X6100    ←→  WiFi/Ethernet (CAT + Audio nativos)       │
└───────────────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. WebRTC Layer (`remote/webrtc_peer.py`)

**Biblioteca**: aiortc 1.x (Python, asyncio, BSD)

- `RTCPeerConnection` por sessão de operador
- Track RX: `AudioStreamTrack` que produz frames 20ms do sounddevice
- Track TX: `MediaStreamTrack` que consome frames do browser e escreve no sounddevice
- Codec: Opus 48kHz, mono (adequado para SSB)
- Latência típica: <80ms LAN, <150ms WAN (com VPN)
- ICE: apenas candidatos host e srflx (sem TURN obrigatório para LAN)

**Fluxo offer/answer (R1/R2)**:
```
Browser                         Backend
   |                               |
   |--- POST /api/webrtc/offer --> |  (SDP offer com mic track)
   |                               |  cria RTCPeerConnection
   |                               |  adiciona audio_rx track
   |                               |  processa offer, gera answer
   |<-- 200 OK {sdp: answer} ----- |
   |                               |
   |=== DTLS handshake ==========> |
   |                               |
   |<== Opus RX audio (contínuo) = |  (sounddevice → AudioFrame → SRTP)
   |=== Opus TX audio (ao falar) = |  (mic browser → SRTP → sounddevice)
```

### 2. CAT Driver (`remote/cat_driver.py`)

**Interface**: rigctld TCP (Hamlib 4.7.1)

O rigctld corre como daemon no host com acesso físico ao rádio. O backend liga-se via TCP socket e envia comandos Hamlib estendido.

Comandos utilizados:
```
\get_freq           → frequência actual (Hz)
\set_freq Hz        → set frequência
\get_mode           → modo e largura de banda
\set_mode MODE BW   → set modo (USB, LSB, CW, FM, AM, FT8)
\get_level STRENGTH → nível S-meter (0-9+)
\set_ptt PTT        → PTT on (1) / off (0)
\get_ptt            → estado PTT
```

**Reconexão**: backoff exponencial 1s → 2s → 4s → 8s (max)

### 3. Perfis de rádio

#### FT-991A (`profiles/ft991a.py`)
- Hamlib model: **1035** (FT-991, Stable)
- rigctld: `rigctld -m 1035 -r /dev/ttyUSB0 -s 38400`
- Audio device: "USB Audio CODEC" (48kHz estéreo)
  - Canal L (index 0): RX AF
  - Canal R (index 1): TX AF
- TX: injeção AF no canal R + PTT via rigctld

#### X6100 (`profiles/x6100.py`)
- Hamlib model: **3087** (X6100, Stable)
- rigctld: `rigctld -m 3087 -r /dev/ttyUSB0 -s 38400` (USB)  
  ou: `rigctld -m 3087 --rig-file tcp://192.168.x.x:50001` (rede nativa)
- Audio: USB Audio Codec ou rede nativa via wfview protocol
- Vantagem: pode funcionar completamente sem USB (WiFi nativo)

### 4. Audio I/O (`remote/audio_rx.py`, `audio_tx.py`)

**Biblioteca**: sounddevice (PortAudio wrapper)

- Sample rate: 48kHz (nativo USB Audio do FT-991A)
- Format: s16le (16-bit signed little-endian)
- Chunk size: 960 samples = 20ms (ideal para Opus)
- Buffer: queue asyncio para desacoplamento sounddevice ↔ WebRTC

**audio_rx.py** (RX: rádio → browser):
```python
# sounddevice input stream (canal L, 48kHz) → queue → AudioFrame → WebRTC
```

**audio_tx.py** (TX: browser → rádio):
```python
# WebRTC AudioFrame → queue → resample se necessário → sounddevice output (canal R, 48kHz)
```

### 5. Decoders (reutilizados do 4ham)

Todos os decoders foram desenvolvidos para o 4ham-spectrum-analysis. A adaptação principal é a **fonte de amostras**: em vez de IQ do SDR, recebem AF directamente do transceptor.

| Decoder | Adaptação necessária |
|---|---|
| `decoders/cw/` + `cw_session.py` | Trocar `iq_provider` por `af_provider` (sounddevice) |
| `decoders/ft_external.py` | Receber AF 48kHz mono; gravar janela WAV; invocar `jt9` |
| `decoders/ft_pipeline.py` | AF mono 48kHz em vez de IQ |
| `decoders/ft_sync.py` | Sem alteração — sincronização temporal 15s igual |
| `decoders/ssb_asr.py` | AF directa — sem alteração |
| `decoders/aprs_parser.py` | Sem alteração |
| `decoders/direwolf_kiss.py` | Sem alteração — Direwolf faz o decode de áudio |
| `decoders/aprs_is.py` | Sem alteração |

### 6. DSP e Waterfall (reutilizados do 4ham)

- `dsp/pipeline.py` — FFT, detecção de picos, AGC, estimativa de ocupância
  - Fonte: AF mono 48kHz do transceptor (em vez de IQ do SDR)
  - Janela FFT: 2048 amostras (~42ms a 48kHz)
- `streaming.py` — compressão delta int8 para WebSocket
  - Sem alteração — algoritmo agnóstico da fonte

### 7. WebSocket (`websocket/`)

Adaptados do 4ham. Arquitectura pub/sub via `events.py`:

| Endpoint | Payload | Frequência |
|---|---|---|
| `ws/spectrum` | Waterfall AF (delta int8) | ~10 fps |
| `ws/decoders/ft` | Spots FT8/FT4 (JSON) | A cada decode |
| `ws/decoders/cw` | Texto CW + WPM (JSON) | Contínuo |
| `ws/decoders/ssb` | Transcrição SSB (JSON) | Contínuo |
| `ws/events` | Eventos gerais (freq change, PTT, APRS) | On event |

### 8. Autenticação e Segurança

Reutiliza `core/auth.py` do 4ham (bcrypt).

- HTTPS obrigatório (WebRTC requer origem segura)
- Basic Auth em todos os endpoints
- Dois perfis de utilizador:
  - `rx_only`: pode ligar WebRTC RX, ver waterfall, ver decodes
  - `operator`: pode fazer RX + TX + set freq/mode + PTT
- PTT safety:
  - Timeout de sessão: PTT desliga automaticamente se WebRTC cair
  - TX timer máximo configurável (padrão: 180 segundos)
  - Não autoriza PTT se freq fora de bandas configuradas

### 9. Storage (reutilizado do 4ham)

`storage/db.py` — SQLite WAL mode

Tabelas adicionais para o Remote:
```sql
CREATE TABLE qso_log (
    id INTEGER PRIMARY KEY,
    ts_start DATETIME,
    ts_end DATETIME,
    freq_hz INTEGER,
    mode TEXT,
    callsign TEXT,        -- se detectado por decoder
    notes TEXT,
    operator TEXT         -- username
);

CREATE TABLE tx_log (
    id INTEGER PRIMARY KEY,
    ts DATETIME,
    freq_hz INTEGER,
    mode TEXT,
    duration_ms INTEGER,
    operator TEXT
);
```

---

## Arquitectura Windows (R4)

No Windows, o áudio USB não está acessível dentro de Docker. A solução é um bridge nativo:

```
┌────────────────────────────────────────────────────────────┐
│  Windows Host                                              │
│                                                            │
│  ┌──────────────────────┐    ┌────────────────────────┐   │
│  │  audio_bridge.py     │    │  rigctld.exe           │   │
│  │  (Python nativo)     │    │  (Hamlib Windows)      │   │
│  │                      │    │  porta :4532           │   │
│  │  sounddevice → PCM   │    └────────────────────────┘   │
│  │  socket :9999        │              ↑                  │
│  └──────────┬───────────┘    host.docker.internal         │
│             │ TCP :9999                │                  │
│  ┌──────────▼───────────────────────────────────────────┐ │
│  │  Docker Container (4ham-remote)                      │ │
│  │                                                      │ │
│  │  audio_rx.py ← recebe PCM de :9999                   │ │
│  │  audio_tx.py → envia PCM para :9999                  │ │
│  │  cat_driver.py → host.docker.internal:4532           │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

**Protocolo audio_bridge** (PCM TCP):
```
[4 bytes big-endian: comprimento em bytes] [PCM s16le, 48kHz, mono]
```
Chunk de 20ms = 960 samples × 2 bytes = 1920 bytes por mensagem.

---

## Decisões de arquitectura

| Decisão | Alternativa considerada | Razão da escolha |
|---|---|---|
| aiortc WebRTC | WebSocket + PCM | WebRTC: <80ms, Opus nativo, browser suportado |
| rigctld TCP | python-hamlib bindings | Sem dependências nativas Python; rigctld mais estável |
| sounddevice | PyAudio | sounddevice: asyncio-friendly, API mais limpa |
| Copy de módulos 4ham | pip editable install | Simplicidade de deploy; sem dependência circular de repositórios |
| SQLite WAL | PostgreSQL | Sem servidor; zero-config; WAL suporta escritas concorrentes |
| Opus 48kHz mono | PCM 8kHz | Qualidade SSB adequada; compressão Opus ≈60kbps |

---

## Limitações conhecidas (v0.1)

1. **Um operador de cada vez**: sem gestão de concorrência multi-operador
2. **LAN/VPN only**: sem TURN server; remoting por Internet requer VPN (WireGuard recomendado)
3. **Linux host**: audio_bridge.py necessário para Windows (R4)
4. **X6100 modo rede**: protocolo wfview não documentado publicamente; pode precisar de engenharia reversa parcial
5. **FT8 TX**: não planeado em R3 (apenas decode); encode e TX em fase futura
