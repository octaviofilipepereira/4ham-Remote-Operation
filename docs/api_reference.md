<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-17 UTC
-->

# 4HAM Remote Operation — REST API Reference

Technical reference for developers. All endpoints are served over HTTPS on port 8001.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Rig Control — `/api/rig`](#2-rig-control--apirig)
3. [WebRTC — `/api/webrtc`](#3-webrtc--apiwebrtc)
4. [QSO Log — `/api/log`](#4-qso-log--apilog)
5. [DX Spots — `/api/dx`](#5-dx-spots--apidx)
6. [Error Responses](#6-error-responses)

---

## 1. Authentication

All endpoints require **HTTP Basic Auth**.

```
Authorization: Basic <base64(username:password)>
```

Credentials are configured in `config/remote_config.yaml`. Passwords are stored as bcrypt hashes.

**Caching:** Successful authentication results are cached for 120 seconds to avoid bcrypt overhead on every request. The cache is per-credential and invalidated on mismatch.

**Failure response:**
```
HTTP 401 Unauthorized
WWW-Authenticate: Basic realm="4ham"
```

---

## 2. Rig Control — `/api/rig`

### GET `/api/rig/status`

Returns current transceiver state.

**Response:**
```json
{
  "frequency_hz": 7114400,
  "mode": "USB",
  "passband_hz": 2400,
  "strength_db": -44.0,
  "ptt": false
}
```

| Field | Type | Description |
|---|---|---|
| `frequency_hz` | integer | VFO frequency in Hz |
| `mode` | string | Current mode: `USB`, `LSB`, `CW`, `FM`, `AM`, `FT8`, etc. |
| `passband_hz` | integer | Passband width in Hz |
| `strength_db` | float | S-meter reading in dBm |
| `ptt` | boolean | PTT state (true = transmitting) |

**Errors:**
- `503 Service Unavailable` — rigctld not reachable

---

### POST `/api/rig/frequency`

Set VFO frequency.

**Request body:**
```json
{
  "frequency_hz": 14225000
}
```

**Response:**
```json
{
  "ok": true,
  "frequency_hz": 14225000
}
```

**Errors:**
- `400 Bad Request` — invalid frequency (< 100 kHz or > 450 MHz)
- `503 Service Unavailable` — rigctld not reachable

---

### POST `/api/rig/mode`

Set radio mode and passband.

**Request body:**
```json
{
  "mode": "USB",
  "passband_hz": 2400
}
```

`passband_hz` is optional. If omitted, the radio uses its default passband for the mode.

**Response:**
```json
{
  "ok": true,
  "mode": "USB",
  "passband_hz": 2400
}
```

---

### POST `/api/rig/ptt`

Set PTT state.

**Request body:**
```json
{
  "enabled": true
}
```

**Request body fields:**

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Desired PTT state (`true` = TX, `false` = RX) |

**Response:**
```json
{
  "ok": true,
  "ptt": true
}
```

> ⚠️ PTT remains active until explicitly released (`enabled: false`). The WebRTC session monitors the connection and releases PTT automatically if the connection drops.

> **RX muting:** While PTT is active, the server automatically silences the RX audio track sent to the browser. This prevents acoustic echo without requiring any client-side configuration. RX audio resumes immediately on PTT release.

---

## 3. WebRTC — `/api/webrtc`

### POST `/api/webrtc/offer`

Initiates a WebRTC session for bidirectional audio (RX from radio + TX to radio).

**Request body:** SDP offer (JSON, standard WebRTC format)
```json
{
  "sdp": "v=0\r\no=- ...\r\n...",
  "type": "offer"
}
```

**Response:** SDP answer
```json
{
  "sdp": "v=0\r\no=- ...\r\n...",
  "type": "answer"
}
```

**Audio tracks:**

| Track direction | Content |
|---|---|
| Server → Client (RX) | Opus 48 kHz, mono — demodulated audio from the radio's USB Audio CODEC |
| Client → Server (TX) | Opus 48 kHz, mono — microphone audio sent to radio TX input |

TX audio is only applied to the radio when PTT is active (`/api/rig/ptt` with `enabled: true`).

---

## 4. QSO Log — `/api/log`

### GET `/api/log/qsos`

Returns recent QSO log entries.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Maximum number of records to return |
| `offset` | integer | 0 | Pagination offset |

**Response:**
```json
{
  "total": 142,
  "qsos": [
    {
      "id": 142,
      "timestamp_utc": "2026-05-13T14:23:00Z",
      "callsign": "EA1ABC",
      "frequency_hz": 7114400,
      "mode": "USB",
      "band": "40m",
      "rst_sent": "59",
      "rst_rcvd": "57",
      "name": "Manuel",
      "qth": "Madrid",
      "notes": ""
    }
  ]
}
```

---

### POST `/api/log/qso`

Create a new QSO log entry.

**Request body:**
```json
{
  "callsign": "EA1ABC",
  "frequency_hz": 7114400,
  "mode": "USB",
  "rst_sent": "59",
  "rst_rcvd": "57",
  "name": "Manuel",
  "qth": "Madrid",
  "notes": ""
}
```

`frequency_hz`, `mode`, `band`, and `timestamp_utc` are filled automatically from the current rig state if omitted.

**Response:**
```json
{
  "ok": true,
  "id": 143,
  "timestamp_utc": "2026-05-13T14:25:00Z"
}
```

---

### DELETE `/api/log/qso/{id}`

Delete a QSO entry by ID.

**Response:**
```json
{
  "ok": true
}
```

---

## 5. DX Spots — `/api/dx`

### GET `/api/dx/spots`

Returns current DX spots for the ruler display.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `band` | string | (all) | Filter by band: `40m`, `20m`, etc. |
| `limit` | integer | 100 | Maximum spots to return |

**Response:**
```json
{
  "spots": [
    {
      "callsign": "ZL2BC",
      "frequency_hz": 14195000,
      "band": "20m",
      "mode": "SSB",
      "spotter": "CT7BFV",
      "comment": "59 good signal",
      "timestamp_utc": "2026-05-13T14:20:00Z"
    }
  ]
}
```

> *Note: DX spot integration with an external cluster is under development. Current implementation uses demo data.*

---

## 6. Error Responses

All error responses follow this format:

```json
{
  "detail": "Human-readable error message"
}
```

| HTTP Status | Meaning |
|---|---|
| `400 Bad Request` | Invalid request parameters |
| `401 Unauthorized` | Missing or invalid credentials |
| `404 Not Found` | Resource not found |
| `503 Service Unavailable` | Backend dependency unavailable (rigctld, audio device) |
| `500 Internal Server Error` | Unexpected server error |

---

*See [websocket_spec.md](websocket_spec.md) for WebSocket endpoint documentation.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
