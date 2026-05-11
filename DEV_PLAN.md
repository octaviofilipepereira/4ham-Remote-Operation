# DEV_PLAN — 4ham Remote Operation

**Plano de desenvolvimento detalhado**  
**Versão**: 0.1 (Maio 2026)  
**Projectista**: CT7BFV

---

## Regras de desenvolvimento

1. **Branch model**: `main` (estável) → `unstable` (desenvolvimento) → feature branches
2. **Commits**: mensagens em Inglês, prefixo `[R1]`, `[R2]`, `[R3]`, `[R4]` por fase
3. **Testes**: cada módulo novo deve ter teste unitário mínimo antes de merge
4. **Cópia de código 4ham**: sempre com comentário `# from 4ham-spectrum-analysis` e data da cópia
5. **Segurança TX**: qualquer alteração ao código de PTT exige revisão explícita

---

## Fase R1 — Setup e RX Browser

### Sprint R1-A: Scaffolding (estimativa: 1-2 dias)

**Objectivo**: Projecto compilável com FastAPI a responder em localhost.

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Inicializar Git | `.git/`, `.gitignore` | Adicionar `__pycache__`, `.venv`, `*.db`, `*.wav` |
| Criar `.gitignore` | `.gitignore` | Python + Node + VSCode |
| Criar `backend/requirements.txt` | `backend/requirements.txt` | FastAPI, uvicorn, aiortc, sounddevice, numpy, scipy |
| Criar `backend/app/main.py` base | `backend/app/main.py` | FastAPI app + CORS + lifespan |
| Criar `backend/app/remote/__init__.py` | — | Pasta do novo código |
| Copiar módulos 4ham | `decoders/`, `dsp/`, `core/`, `storage/`, `config/`, `streaming.py` | Ver lista abaixo |
| Criar `config/remote_config.yaml` | `config/remote_config.yaml` | rigctld host/port, audio device |
| Criar `config/remote_config.schema.json` | `config/remote_config.schema.json` | JSON Schema para validação |

**Módulos a copiar do 4ham** (sprint R1-A):
```
4ham/backend/app/decoders/         → backend/app/decoders/
4ham/backend/app/dsp/              → backend/app/dsp/
4ham/backend/app/core/auth.py      → backend/app/core/auth.py
4ham/backend/app/core/features.py  → backend/app/core/features.py (opcional)
4ham/backend/app/storage/db.py     → backend/app/storage/db.py
4ham/backend/app/config/loader.py  → backend/app/config/loader.py
4ham/backend/app/streaming.py      → backend/app/streaming.py
4ham/prefixes/dxcc_coords.json     → prefixes/dxcc_coords.json
4ham/prefixes/iaru_region1_prefixes.json → prefixes/iaru_region1_prefixes.json
```

---

### Sprint R1-B: CAT Driver (estimativa: 1-2 dias)

**Objectivo**: Controlo CAT funcional em ambos os rádios.

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Implementar `cat_driver.py` | `backend/app/remote/cat_driver.py` | Classe `RigCtldClient` — TCP socket asyncio |
| Comandos base | — | `get_freq`, `set_freq`, `get_mode`, `set_mode`, `get_level`, `get_ptt`, `set_ptt` |
| Reconexão automática | — | backoff 1s → 2s → 4s → 8s max |
| Perfil FT-991A | `backend/app/remote/profiles/ft991a.py` | Modelo 1035, /dev/ttyUSB0 |
| Perfil X6100 | `backend/app/remote/profiles/x6100.py` | Modelo 3087, USB ou TCP |
| Endpoints REST CAT | `backend/app/api/rig.py` | GET /api/rig/status, POST /api/rig/freq, POST /api/rig/mode |
| Teste manual FT-991A | — | rigctld manual + curl para verificar endpoints |
| Teste manual X6100 | — | Ligação WiFi nativa |
| Teste unitário | `tests/test_cat_driver.py` | Mock socket, testar parse de respostas rigctld |

**Exemplo de resposta rigctld**:
```
Frequency: 14200000
Mode: USB
Passband: 2400
```

**rigctld para FT-991A**:
```bash
rigctld -m 1035 -r /dev/ttyUSB0 -s 38400 -T 0.0.0.0 -t 4532
```

**rigctld para X6100 (USB)**:
```bash
rigctld -m 3087 -r /dev/ttyUSB0 -s 115200 -T 0.0.0.0 -t 4532
```

---

### Sprint R1-C: WebRTC RX (estimativa: 2-3 dias)

**Objectivo**: Browser a ouvir o FT-991A em tempo real via WebRTC.

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Implementar `audio_rx.py` | `backend/app/remote/audio_rx.py` | sounddevice input → asyncio queue → AudioFrame |
| Classe `AudioRxTrack` | — | Herda `AudioStreamTrack` do aiortc |
| Chunk size 960 samples | — | 20ms @ 48kHz = Opus frame perfeito |
| Implementar `webrtc_peer.py` | `backend/app/remote/webrtc_peer.py` | RTCPeerConnection, add RX track, offer/answer |
| Endpoint `POST /api/webrtc/offer` | `backend/app/api/webrtc.py` | Recebe SDP, devolve answer JSON |
| Endpoint `POST /api/webrtc/close` | — | Encerra peer connection |
| Frontend básico RX | `frontend/index.html`, `frontend/app.js` | Botão "Listen", RTCPeerConnection, `<audio>` element |
| Teste com FT-991A + browser | — | Chrome/Firefox em LAN |
| Medir latência RX | — | Alvo: <80ms LAN |

**Exemplo WebRTC offer/answer no frontend**:
```javascript
const pc = new RTCPeerConnection();
pc.ontrack = (event) => { audioElement.srcObject = event.streams[0]; };
const offer = await pc.createOffer({ offerToReceiveAudio: true });
await pc.setLocalDescription(offer);
const response = await fetch('/api/webrtc/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp: offer.sdp, type: offer.type })
});
const answer = await response.json();
await pc.setRemoteDescription(answer);
```

---

### Sprint R1-D: Auth e Config (estimativa: 1 dia)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Integrar `core/auth.py` | `backend/app/dependencies/auth.py` | FastAPI Depends com Basic Auth |
| `config/remote_config.yaml` com users | — | `users: [{username: ct7bfv, password_hash: ..., role: operator}]` |
| Script `scripts/hash_password.py` | — | Já existe no 4ham — copiar |
| Proteger todos os endpoints | — | Excepto `/health` |
| HTTPS dev (self-signed) | `certs/` | `openssl req -x509 ...` |
| Teste de auth | — | curl com e sem credenciais |

---

## Fase R2 — TX Voz SSB

### Sprint R2-A: Áudio TX (estimativa: 2 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Implementar `audio_tx.py` | `backend/app/remote/audio_tx.py` | WebRTC AudioFrame → queue → sounddevice output |
| Resample se necessário | — | Opus pode vir a 48kHz; FT-991A TX audio: 48kHz |
| Adicionar TX track ao `webrtc_peer.py` | — | `pc.addTrack()` para receber mic do browser |
| Frontend: mic capture | `frontend/app.js` | `navigator.mediaDevices.getUserMedia({audio: true})` |
| Teste loopback | — | Ouvir o próprio mic de volta via rádio (sem RF, antena desligada) |

### Sprint R2-B: PTT (estimativa: 1-2 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Endpoint `POST /api/rig/ptt` | `backend/app/api/rig.py` | Apenas se WebRTC activo + role=operator |
| PTT safety timeout | `backend/app/remote/ptt_watchdog.py` | asyncio task, detecta WebRTC disconnect |
| TX timer máximo | — | Configurável, padrão 180s |
| Log TX em SQLite | `storage/db.py` | Tabela `tx_log` |
| Indicador TX no frontend | `frontend/app.js` | Classe CSS `.transmitting` em vermelho |
| Teste com FT-991A | — | Verificar RF com power meter ou dummy load |

---

## Fase R3 — Modos Digitais

### Sprint R3-A: FT8/FT4 Decode (estimativa: 2-3 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Adaptar `ft_external.py` para AF | `backend/app/decoders/ft_external.py` | Substituir iq_provider por af_provider sounddevice |
| Gravar janelas WAV 15s/7.5s | — | `tempfile.NamedTemporaryFile` WAV mono 48kHz |
| Integrar `ft_sync.py` | — | Alinhamento temporal ao ciclo FT8 |
| Instalar jt9 | `install.sh` | `sudo apt install wsjtx` ou build from source |
| WebSocket `ws/decoders/ft` | `backend/app/websocket/ft.py` | Spots em JSON: callsign, grid, dB, DT, freq |
| Frontend: painel FT8 | `frontend/modules/ft_panel.js` | Lista de spots, highlight de callsigns |

### Sprint R3-B: CW Decode (estimativa: 1-2 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Adaptar `cw_session.py` para AF | `backend/app/decoders/cw_session.py` | Trocar iq_provider por sounddevice stream |
| `cw/decoder.py`, `dsp.py`, `timing.py` | — | Sem alteração |
| WebSocket `ws/decoders/cw` | `backend/app/websocket/cw.py` | Texto + WPM em JSON |
| Frontend: painel CW | `frontend/modules/cw_panel.js` | Texto ao vivo + WPM badge |

### Sprint R3-C: Waterfall AF (estimativa: 1-2 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Adaptar `websocket/spectrum.py` para AF | `backend/app/websocket/spectrum.py` | Fonte AF sounddevice em vez de IQ SDR |
| `dsp/pipeline.py` | — | Sem alteração — agnóstico da fonte |
| `streaming.py` | — | Sem alteração |
| Frontend: waterfall canvas | `frontend/modules/waterfall.js` | Canvas 2D, scrolling, colormap |

### Sprint R3-D: APRS (estimativa: 1 dia)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| `direwolf_kiss.py` | — | Sem alteração — Direwolf faz decode de áudio |
| `aprs_parser.py` | — | Sem alteração |
| WebSocket `ws/events` | — | Eventos APRS em JSON |
| Frontend: mapa APRS | `frontend/modules/aprs_map.js` | Reutilizar `map.js` do 4ham |

---

## Fase R4 — Windows Packaging

### Sprint R4-A: audio_bridge.py (estimativa: 1-2 dias)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Implementar `audio_bridge.py` | `audio_bridge/audio_bridge.py` | sounddevice ↔ TCP socket |
| Protocolo PCM TCP | — | `[4 bytes length][PCM s16le 48kHz mono]` |
| Reconexão automática | — | Tenta ligar ao Docker a cada 5s |
| Teste em Windows 11 | — | Com FT-991A USB Audio |

### Sprint R4-B: Dockerfile + docker-compose (estimativa: 1 dia)

| Tarefa | Ficheiro(s) | Notas |
|---|---|---|
| Dockerfile | `Dockerfile` | python:3.11-slim + jt9 + dependências |
| docker-compose.yml | `docker-compose.yml` | Serviço 4ham-remote, portas 8000/443 |
| Adaptar audio_rx/tx para socket TCP | — | Modo Windows: substituir sounddevice por socket client |
| Documentar host.docker.internal | `docs/windows_setup.md` | rigctld em COM port nativo |

---

## Dependências de software

### Backend (Python)
```
fastapi>=0.111
uvicorn[standard]>=0.29
aiortc>=1.9
sounddevice>=0.4.6
numpy>=1.26
scipy>=1.13
aiofiles>=23.2
python-multipart>=0.0.9
bcrypt>=4.1
pyyaml>=6.0
jsonschema>=4.22
aiosqlite>=0.20
```

### Sistema (Linux)
```
libportaudio2          # sounddevice
libavcodec-dev         # aiortc (FFmpeg)
libavformat-dev
libvpx-dev
libopus-dev
wsjtx                  # jt9 para FT8/FT4
```

### Sistema (Windows, nativo)
```
Python 3.11+
Hamlib 4.7.1 (rigctld.exe)
Docker Desktop
```

---

## Testes

### Unitários (pytest)
- `tests/test_cat_driver.py` — mock socket, parse rigctld responses
- `tests/test_audio_rx.py` — mock sounddevice, verificar AudioFrame output
- `tests/test_webrtc_peer.py` — offer/answer SDP, track management
- `tests/test_ptt_watchdog.py` — timeout safety, disconnect handling

### Integração (manual)
- RX: FT-991A + browser LAN → latência, qualidade áudio
- RX: X6100 WiFi + browser LAN
- TX: FT-991A SSB com dummy load, verificar RF
- FT8 decode: 14.074 MHz, ciclo de 15s ao vivo
- CW decode: 7.020 MHz (bandas CW) ao vivo

---

## Próximos passos imediatos

1. `git init` na pasta do projecto
2. Criar `.gitignore` e `backend/requirements.txt`
3. Copiar módulos do 4ham para `backend/app/`
4. Implementar sprint R1-B (CAT driver) — é o mais independente e testável rapidamente
5. Testar rigctld com FT-991A antes de qualquer código Python

---

## Referências

- aiortc: https://github.com/aiortc/aiortc
- Hamlib rigctld: https://hamlib.github.io/
- WSJT-X / jt9: https://physics.princeton.edu/pulsar/k1jt/wsjtx.html
- 4ham-spectrum-analysis: projecto irmão — fonte dos módulos reutilizados
- UHRR (referência histórica): https://github.com/F4HTB/Universal_HamRadio_Remote
