<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-17 UTC
-->

# 4HAM Remote Operation — WebSocket Specification

Technical reference for developers integrating with the 4HAM Remote Operation WebSocket endpoints.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Spectrum WebSocket — `/ws/spectrum`](#3-spectrum-websocket--wsspectrum)
   - [Connection](#connection)
   - [Frame Format](#frame-format)
   - [Delta Int8 Encoding](#delta-int8-encoding)
   - [Client Lifecycle](#client-lifecycle)
4. [TX Monitor WebSocket — `/ws/tx-monitor`](#4-tx-monitor-websocket--wstx-monitor)
5. [Future Endpoints](#5-future-endpoints)

---

## 1. Overview

4HAM Remote Operation exposes WebSocket endpoints over the same HTTPS/WSS port as the REST API (default: 8000).

All WebSocket connections require HTTP Basic Auth (same credentials as the REST API).

| Endpoint | Purpose | Status |
|---|---|---|
| `wss://<host>:8001/ws/spectrum` | AF spectrum FFT frames | Active |
| `wss://<host>:8001/ws/tx-monitor` | TX post-DSP audio for monitoring | Active |
| `wss://<host>:8001/ws/ft` | FT8/FT4 decode events | Planned |
| `wss://<host>:8001/ws/cat` | CAT status push | Planned |

---

## 2. Authentication

WebSocket connections use HTTP Basic Auth in the initial HTTP Upgrade request header:

```
Authorization: Basic <base64(username:password)>
```

Connections without valid credentials are rejected with HTTP 401.

---

## 3. Spectrum WebSocket — `/ws/spectrum`

### Connection

```
wss://<host>:8000/ws/spectrum
```

After the handshake, the server begins pushing binary frames at approximately **10 frames per second**.

### Frame Format

Each frame is a binary WebSocket message with the following structure:

```
[1 byte: encoding_type]
[4 bytes: float32 little-endian — min_db]
[4 bytes: float32 little-endian — max_db]
[N bytes: encoded spectrum data]
```

| Field | Type | Size | Description |
|---|---|---|---|
| `encoding_type` | uint8 | 1 byte | Encoding format (see below) |
| `min_db` | float32 LE | 4 bytes | Minimum dB value for denormalisation |
| `max_db` | float32 LE | 4 bytes | Maximum dB value for denormalisation |
| `data` | bytes | N bytes | Encoded spectrum bins |

### Encoding Types

| Value | Name | Description |
|---|---|---|
| `0x01` | `raw_float32` | Raw float32 array, N/4 bins |
| `0x02` | `delta_int8` | Delta-encoded int8 (primary encoding) |

### Delta Int8 Encoding

The `delta_int8` encoding is the primary and most efficient format.

**Encoding process (server-side):**

1. FFT bins (float32, dB scale) are quantised to int8 range:
   ```
   quantised[i] = round(clamp((bin[i] - min_db) / (max_db - min_db) * 255, 0, 255)) - 128
   ```
2. Delta encoding: each byte is the difference from the previous bin:
   ```
   delta[0] = quantised[0]
   delta[i] = quantised[i] - quantised[i-1]   (i > 0)
   ```
3. Bytes outside the int8 range [-128, 127] are clamped.

**Decoding process (client-side):**

```javascript
function decodeSpectrum(buffer) {
    const view = new DataView(buffer);
    const minDb = view.getFloat32(1, true);   // little-endian
    const maxDb = view.getFloat32(5, true);
    const delta = new Int8Array(buffer, 9);

    const n = delta.length;
    const values = new Float32Array(n);

    let acc = 0;
    for (let i = 0; i < n; i++) {
        acc += delta[i];
        // denormalise: map [-128..127] → [minDb..maxDb]
        values[i] = ((acc + 128) / 255) * (maxDb - minDb) + minDb;
    }
    return { values, minDb, maxDb };
}
```

### FFT Parameters

| Parameter | Value | Notes |
|---|---|---|
| FFT size | 2048 | Bins per frame |
| Sample rate | 48000 Hz | Matches USB Audio CODEC |
| Frequency range | 0 – 24000 Hz | AF bandwidth |
| Frame rate | ~10 fps | Server-side rate limit |
| Smoothing | None (server) | Client-side smoothing recommended (α = 0.18) |

### Client Lifecycle

```
Client                              Server
  │                                   │
  │── WSS Upgrade (Basic Auth) ──────>│
  │<─ 101 Switching Protocols ────────│
  │                                   │
  │<─ binary frame (spectrum) ────────│  ~10 fps
  │<─ binary frame (spectrum) ────────│
  │         ...                       │
  │── close ─────────────────────────>│
  │<─ close ──────────────────────────│
```

On server restart or audio pipeline error, the server closes the WebSocket. The client should implement automatic reconnection with exponential back-off (recommended: 1s, 2s, 4s, max 30s).

### JavaScript client example

```javascript
let ws = null;

function connectSpectrum() {
    const url = 'wss://' + location.host + '/ws/spectrum';
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
        const { values, minDb, maxDb } = decodeSpectrum(event.data);
        drawSpectrum(values, minDb, maxDb);
    };

    ws.onclose = () => {
        setTimeout(connectSpectrum, 2000);   // reconnect
    };
}

function decodeSpectrum(buffer) {
    const view = new DataView(buffer);
    const minDb = view.getFloat32(1, true);
    const maxDb = view.getFloat32(5, true);
    const delta = new Int8Array(buffer, 9);
    const n = delta.length;
    const values = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
        acc += delta[i];
        values[i] = ((acc + 128) / 255) * (maxDb - minDb) + minDb;
    }
    return { values, minDb, maxDb };
}
```

---

## 4. TX Monitor WebSocket — `/ws/tx-monitor`

Streams post-DSP TX audio back to the browser for monitoring. Audio is captured after the full DSP chain (HPF + EQ + LPF + expander) and before it reaches the USB audio card.

### Connection

```
wss://<host>:8001/ws/tx-monitor
```

Requires an active WebRTC session with TX audio flowing. If no `audio_tx` instance is active on the server, the connection is closed immediately with code `1011`.

### Frame Format

Each message is a binary WebSocket frame containing raw **PCM16 mono** audio:

| Property | Value |
|---|---|
| Encoding | Signed 16-bit integer (little-endian) |
| Sample rate | 48000 Hz |
| Channels | 1 (mono) |
| Samples per frame | 960 (20 ms per frame) |
| Frame size | 1920 bytes |

Frames are sent in real time as TX audio is processed. The server drops frames (not queued) if the client cannot keep up (queue size limit: 16 frames ≈ 320 ms).

### Client Behaviour

The recommended client pattern (as implemented in the 4HAM frontend) buffers frames during PTT and plays them back after PTT release:

```javascript
// During PTT: buffer frames, do not play
if (pttActive) {
    buffer.push(float32Frame);
    return;
}
// After PTT release: schedule buffered frames for playback
for (const frame of buffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = /* AudioBuffer from frame */;
    src.start(nextTime);
    nextTime += src.buffer.duration;
}
buffer = [];
```

This prevents acoustic echo: audio plays only after the microphone is deactivated.

### Client Lifecycle

```
Client                              Server
  │                                   │
  │── WSS Upgrade (Basic Auth) ──────>|
  |←─ 101 Switching Protocols ─────────|
  |                                   |
  |  [PTT pressed by user]            |
  |←─ binary frame (PCM16, 960 samp) ─|  ~50 fps during TX
  |←─ binary frame (PCM16, 960 samp) ─|
  |          ...                      |
  |  [PTT released]                   |
  |  [client plays buffered frames]   |
  |                                   |
  |── close ─────────────────────────>|
  |←─ close ──────────────────────────|
```

---

## 5. Future Endpoints

### `wss://<host>:8001/ws/ft` (planned)

Will push FT8/FT4 decode events as JSON messages:

```json
{
  "type": "ft8_decode",
  "timestamp_utc": "2026-05-13T14:23:00Z",
  "frequency_hz": 14074000,
  "snr_db": -12.5,
  "message": "CT7BFV EA1ABC -12",
  "callsign": "EA1ABC",
  "grid": "IN53"
}
```

### `wss://<host>:8001/ws/cat` (planned)

Will push CAT status updates on change (frequency, mode, PTT):

```json
{
  "type": "cat_status",
  "frequency_hz": 7114400,
  "mode": "USB",
  "passband_hz": 2400,
  "strength_db": -44.0,
  "ptt": false
}
```

---

*See [api_reference.md](api_reference.md) for REST API documentation.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
