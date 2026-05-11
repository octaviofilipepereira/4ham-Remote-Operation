# ROADMAP — 4ham Remote Operation

**Produto**: Operação remota completa de estação de rádio amador via browser  
**Indicativo**: CT7BFV — Octávio Filipe Pereira  
**Início**: Maio 2026  
**Stack base**: FastAPI + aiortc (WebRTC) + rigctld + sounddevice

---

## Visão geral das fases

```
R1 — RX Browser        → ouvir o rádio no browser em tempo real
R2 — TX Voz SSB        → transmitir voz SSB pelo browser (mic WebRTC)
R3 — Modos Digitais    → FT8, FT4, CW decode/encode, APRS
R4 — Packaging Windows → Docker + rigctld.exe + audio_bridge.py
```

---

## R1 — RX Browser (Fase 1)

**Objectivo**: Ouvir o rádio em tempo real no browser, com controlo básico de CAT.

**Critério de conclusão**: O FT-991A e o X6100 transmitem áudio AF ao browser via WebRTC Opus com latência <80ms em LAN.

### Tarefas R1

#### R1.1 — Scaffolding do projecto
- [ ] Inicializar repositório Git
- [ ] Criar `backend/requirements.txt` com dependências base (FastAPI, uvicorn, aiortc, sounddevice, numpy)
- [ ] Criar `backend/app/main.py` com FastAPI + CORS
- [ ] Copiar módulos do 4ham: `decoders/`, `dsp/`, `core/auth.py`, `storage/`, `config/`, `streaming.py`
- [ ] Criar `backend/app/remote/` (pasta vazia com `__init__.py`)

#### R1.2 — Driver CAT (rigctld TCP)
- [ ] Implementar `backend/app/remote/cat_driver.py`
  - Ligar ao rigctld via TCP (host:port configurável)
  - Comandos: `get_freq`, `set_freq`, `get_mode`, `set_mode`, `get_level` (S-meter)
  - Reconexão automática com backoff
- [ ] Criar perfil FT-991A: `backend/app/remote/profiles/ft991a.py`
  - Modelo Hamlib 1035, porta USB típica `/dev/ttyUSB0`
  - Audio device: USB Audio CODEC (48kHz, L=RX, R=TX)
- [ ] Criar perfil X6100: `backend/app/remote/profiles/x6100.py`
  - Modelo Hamlib 3087, endereço IP configurável
  - Audio via rede nativa (wfview protocol ou USB Audio se ligado por USB)
- [ ] Endpoints REST `api/rig.py`:
  - `GET /api/rig/status` — freq, mode, s-meter, PTT state
  - `POST /api/rig/freq` — set frequência
  - `POST /api/rig/mode` — set modo (USB/LSB/CW/FM/AM)

#### R1.3 — Áudio RX via WebRTC
- [ ] Implementar `backend/app/remote/audio_rx.py`
  - Captura sounddevice (canal L = RX) em chunks de 20ms
  - Converte para AudioFrame aiortc (s16le, 48kHz, mono)
  - Expõe como `AudioStreamTrack` asyncio
- [ ] Implementar `backend/app/remote/webrtc_peer.py`
  - `RTCPeerConnection` aiortc
  - Adiciona `audio_rx` track
  - Handle offer/answer SDP
- [ ] Endpoints REST `api/webrtc.py`:
  - `POST /api/webrtc/offer` — recebe SDP offer do browser, devolve answer
  - `POST /api/webrtc/close` — encerra peer connection

#### R1.4 — Frontend RX
- [ ] `frontend/index.html` — layout básico: freq display, mode selector, S-meter, audio player
- [ ] `frontend/app.js` — WebRTC offer/answer, `RTCPeerConnection`, audio element
- [ ] `frontend/styles.css` — look & feel inspirado no 4ham frontend

#### R1.5 — Configuração e segurança
- [ ] `config/remote_config.yaml` + JSON schema
  - rigctld host/port, audio device, auth users
- [ ] `config/radio_profiles.yaml` — perfis FT-991A e X6100
- [ ] Auth Basic bcrypt (reutilizar `core/auth.py` do 4ham)
- [ ] HTTPS obrigatório para WebRTC (self-signed para dev, Let's Encrypt para prod)

---

## R2 — TX Voz SSB (Fase 2)

**Objectivo**: Transmitir voz SSB pelo browser com PTT seguro.

**Critério de conclusão**: Operador clica PTT no browser → rádio transmite → liberta PTT → rádio volta a RX. Áudio de TX via mic do operador com qualidade SSB adequada.

**Pré-requisito**: R1 concluído e estável.

### Tarefas R2

#### R2.1 — Áudio TX
- [ ] Implementar `backend/app/remote/audio_tx.py`
  - Recebe `MediaStreamTrack` audio do browser via aiortc
  - Resample Opus 48kHz → sample rate do TRX (tipicamente 8kHz ou 48kHz conforme rádio)
  - Escreve para sounddevice (canal R = TX do FT-991A)
- [ ] Adicionar track de TX ao `webrtc_peer.py`

#### R2.2 — PTT seguro
- [ ] Implementar PTT via rigctld (`set_ptt on/off`)
- [ ] **Safety timeout**: se WebRTC desligar inesperadamente → PTT OFF automático em <500ms
- [ ] **TX timer**: limite máximo configurável de tempo de transmissão (ex: 3 minutos)
- [ ] Indicador visual de TX no frontend (vermelho quando PTT activo)
- [ ] Endpoint `POST /api/rig/ptt` com validação de sessão WebRTC activa
- [ ] Log de cada transmissão (duração, modo, freq) em SQLite

#### R2.3 — Segurança TX
- [ ] Verificar que a sessão WebRTC está activa antes de autorizar PTT
- [ ] Não permitir PTT se freq < 1.8 MHz ou > 30 MHz (configurável por perfil de rádio)
- [ ] Rate limiting: máximo N transmissões por minuto
- [ ] Autenticação obrigatória para TX (pode haver utilizadores só-RX)

#### R2.4 — Testes com FT-991A
- [ ] Teste RX: ouvir 40m/20m SSB ao vivo
- [ ] Teste TX: fazer QSO curto de teste via browser
- [ ] Medir latência RX e TX end-to-end em LAN

---

## R3 — Modos Digitais (Fase 3)

**Objectivo**: FT8, FT4, CW decode em tempo real. Opcionalmente CW TX e APRS.

**Pré-requisito**: R1 concluído.

### Tarefas R3

#### R3.1 — FT8 / FT4 Decode
- [ ] Adaptar `decoders/ft_external.py` (4ham) para receber áudio AF do TRX
  - Em vez de IQ→AF, receber AF directamente do sounddevice
  - Gravar janela de 15s (FT8) ou 7.5s (FT4) em WAV temporário
  - Invocar `jt9` subprocess com o WAV
- [ ] Adaptar `decoders/ft_pipeline.py` para AF mono 48kHz
- [ ] Reutilizar `decoders/ft_sync.py` para alinhamento temporal 15s
- [ ] WebSocket `ws/decoders/ft` — emite eventos de decode em tempo real
- [ ] Frontend: painel FT8 com lista de spots, callsigns, grid, dB, DT

#### R3.2 — CW Decode
- [ ] Adaptar `decoders/cw_session.py` para receber AF do TRX
  - Trocar `iq_provider` por `af_provider` (sounddevice stream)
  - `decoders/cw/decoder.py`, `dsp.py`, `timing.py` reutilizados sem alteração
- [ ] WebSocket `ws/decoders/cw` — emite texto e WPM em tempo real
- [ ] Frontend: painel CW com texto decoded ao vivo, WPM estimado

#### R3.3 — SSB ASR (Speech Recognition)
- [ ] Adaptar `decoders/ssb_asr.py` (4ham) para áudio AF do TRX
- [ ] WebSocket `ws/decoders/ssb` — emite transcrição ao vivo
- [ ] Frontend: sub-painel de transcrição SSB (opcional, activável pelo utilizador)

#### R3.4 — APRS via Direwolf
- [ ] Reutilizar `decoders/direwolf_kiss.py` (4ham) sem alteração
- [ ] Reutilizar `decoders/aprs_parser.py` sem alteração
- [ ] Frontend: mapa de estações APRS (reutilizar `map.js` do 4ham frontend)

#### R3.5 — Waterfall AF
- [ ] Adaptar `websocket/spectrum.py` do 4ham para fonte AF (sounddevice) em vez de IQ (SDR)
- [ ] Reutilizar `dsp/pipeline.py` e `streaming.py` sem alteração
- [ ] Frontend: waterfall AF no browser (canvas WebGL ou canvas 2D)

#### R3.6 — CW TX (opcional R3)
- [ ] Gerador de CW: converter texto → keying PTT (elemento dit/dah via rigctld)
- [ ] Ou: gerar AF CW e enviar para TX audio
- [ ] Frontend: input de texto → enviar CW

---

## R4 — Packaging Windows (Fase 4)

**Objectivo**: Utilizadores Windows podem correr o servidor remotamente com Docker.

**Pré-requisito**: R1-R3 estáveis em Linux.

### Tarefas R4

#### R4.1 — audio_bridge.py
- [ ] Implementar `audio_bridge/audio_bridge.py`
  - Corre nativamente em Python Windows (sem Docker)
  - Captura sounddevice (canal L = RX AF do FT-991A via USB Audio)
  - Envia chunks PCM 20ms via socket TCP para o container Docker
  - Recebe chunks PCM TX do container via socket e escreve no sounddevice (canal R)
- [ ] Protocolo simples: `[4 bytes length][PCM s16le data]`
- [ ] Reconexão automática se Docker reiniciar

#### R4.2 — Dockerfile
- [ ] Dockerfile multi-stage baseado em `python:3.11-slim`
- [ ] Instalar `jt9` e dependências WSJT-X no container
- [ ] audio_rx/tx no container recebe/envia para `audio_bridge` via socket TCP
- [ ] Expor portas: 8000 (HTTP/WebRTC), 4532 (rigctld passthrough)

#### R4.3 — docker-compose.yml
- [ ] Serviço `4ham-remote` (container principal)
- [ ] Serviço `rigctld` — corre nativamente Windows, não em Docker
- [ ] Documentar configuração `host.docker.internal` para rigctld

#### R4.4 — install.ps1
- [ ] Script PowerShell para Windows:
  - Verificar Docker Desktop instalado
  - Verificar Hamlib instalado (rigctld.exe)
  - Criar atalho para iniciar audio_bridge.py
  - docker-compose up

#### R4.5 — Testes Windows
- [ ] Testar com FT-991A em Windows 11
- [ ] Medir latência end-to-end com audio_bridge

---

## Milestones

| Milestone | Descrição | Estado |
|---|---|---|
| **M0** | Repositório criado, estrutura base, documentação | ✅ Maio 2026 |
| **M1** | R1 completo — RX browser funcional com FT-991A | ⬜ |
| **M2** | R1 com X6100 (WiFi nativo) | ⬜ |
| **M3** | R2 completo — TX voz SSB seguro | ⬜ |
| **M4** | R3 completo — FT8/FT4 + CW decode | ⬜ |
| **M5** | R3 com waterfall AF e APRS | ⬜ |
| **M6** | R4 completo — packaging Windows | ⬜ |
| **M7** | Operação remota real de QSO via Internet (VPN/DDNS) | ⬜ |

---

## Fora de âmbito (por agora)

- Suporte a SDR (coberto pelo 4ham-spectrum-analysis)
- Modos VHF/UHF/satélite (fase futura)
- Remoting por Internet sem VPN (requer STUN/TURN — possível via aiortc mas complexo)
- Interface multi-operador simultâneo
- Logging automático para LoTW/eQSL
