<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-17 UTC
-->

# 4HAM Remote Operation — User Manual

> 🇵🇹 [Versão em Português](user_manual.md)

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [User Requirements](#2-user-requirements)
3. [Accessing the Interface](#3-accessing-the-interface)
4. [Main Interface](#4-main-interface)
   - [VFO and Frequency](#vfo-and-frequency)
   - [Tuning Knob](#tuning-knob)
   - [Mode Selector](#mode-selector)
   - [S-meter](#s-meter)
   - [PTT and Transmission](#ptt-and-transmission)
5. [RX Audio — Listening to the Radio](#5-rx-audio--listening-to-the-radio)
6. [TX Audio — Transmitting SSB Voice](#6-tx-audio--transmitting-ssb-voice)
   - [DSP on the Pi](#dsp-on-the-pi)
   - [Audio Settings](#audio-settings)
   - [TX Post-DSP Monitor](#tx-post-dsp-monitor)
7. [Waterfall and Spectrum](#7-waterfall-and-spectrum)
   - [Spectrum Panel](#spectrum-panel)
   - [AF Waterfall](#af-waterfall)
   - [Colour Interpretation](#colour-interpretation)
8. [DX Cluster and Ruler](#8-dx-cluster-and-ruler)
9. [QSO Log](#9-qso-log)
10. [Status Indicators](#10-status-indicators)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Introduction

**4HAM Remote Operation** is a web application that lets you operate a licensed amateur radio station remotely from any modern browser.

You control the physical transceiver (frequency, mode, PTT) and send/receive audio in real time, as if you were sitting in front of the radio.

### What you can do

- Tune frequency and change mode (SSB, CW, FM, AM, FT8)
- Listen to receive audio via WebRTC with under 80 ms latency on LAN
- Transmit SSB voice using your computer's microphone
- View the AF spectrum and waterfall in real time
- Log QSOs in the built-in log
- View DX spots on the frequency ruler

### Current limitations

- The spectrum/waterfall shows only the AF audio bandwidth of the radio (not wideband RF spectrum)
- TX transmission requires the radio to support PTT via CAT (rigctld)

---

## 2. User Requirements

### Browser

| Browser | Minimum version | Notes |
|---|---|---|
| Google Chrome | 90+ | Recommended |
| Mozilla Firefox | 88+ | Supported |
| Microsoft Edge | 90+ | Supported |
| Safari | 15+ | WebRTC supported |

> **Important:** The browser must support WebRTC. Private/incognito mode may block microphone access required for TX.

### Network connection

- LAN: audio latency < 80 ms
- WAN/Internet: audio latency 100–200 ms (depends on connection quality)
- Minimum recommended bandwidth: 256 kbps (RX only); 512 kbps (RX+TX)

### Browser permissions

- **Microphone**: required for TX (SSB voice transmission)
- The browser will request permission the first time you click **TX HOLD**

---

## 3. Accessing the Interface

The address is provided by the station administrator. Typical format:

```
https://<address>:8001/
```

On first visit, the browser may warn about a self-signed certificate. Click **Advanced** (or equivalent) to proceed.

### Authentication

The interface requests a **username and password** via HTTP Basic Auth. Enter the credentials provided by the administrator.

> Credentials are stored by the browser during the session. Closing the browser or tab ends the session.

---

## 4. Main Interface

### VFO and Frequency

The central display shows the current radio frequency in MHz to 3 decimal places (e.g. `7.120`).

**Ways to change frequency:**

| Method | How to use |
|---|---|
| **Knob** | Rotate with the mouse (drag or scroll) |
| **Scroll on digit** | Hover over a digit and use the scroll wheel |
| **Step buttons** | Click the step buttons (10 Hz to 1 MHz) |
| **Band buttons** | Click directly on a band name (e.g. `40m`) |
| **Softkeys ×1/×10/×100** | Multiply the tuning step |

### Tuning Knob

The VFO knob responds to:
- **Mouse drag** (circular motion)
- **Mouse wheel** over the knob

Each scroll click or knob movement advances one step at the selected tuning step.

### Mode Selector

The **Mode selector** dropdown allows you to choose:

| Mode | Usage |
|---|---|
| **USB** | SSB on bands above 10 MHz (20m, 17m, 15m, 12m, 10m) |
| **LSB** | SSB on bands below 10 MHz (80m, 40m) |
| **CW** | Morse code |
| **FM** | VHF/UHF and 10m |
| **AM** | Amplitude modulation |

### S-meter

The signal bar shows:
- **Level in dBm** — numeric value on the right
- **Signal quality** — text label (Noise floor / Weak / Usable / Clean / Strong / Broadcast)

### PTT and Transmission

> ⚠️ **Caution:** Activating TX causes the radio to transmit RF. Ensure the antenna is connected and that the operator is licensed to transmit on the selected frequency.

**TX HOLD** — keeps PTT active until clicked again to release.

The **TX/RX** badge at the top of the interface shows the current state.

---

## 5. RX Audio — Listening to the Radio

1. Click **Connect** to start the WebRTC connection.
2. Wait for the status badge to change to **Live**.
3. The radio audio will start playing automatically.

> If there is no audio, check that the browser volume is not muted and that the audio badge shows **Live** and not **Fault**.

### Expected latency

| Network | Typical latency |
|---|---|
| LAN (same network) | 40–80 ms |
| WAN (Internet) | 100–200 ms |

---

## 6. TX Audio — Transmitting SSB Voice

> **Pre-requisite:** Mode must be set to USB or LSB. The browser will request microphone access.

1. Select **USB** or **LSB** mode.
2. Click **TX HOLD** — the browser requests microphone permission (first time).
3. The badge changes to **TX** and the radio begins transmitting.
4. Speak normally into the computer microphone.
5. Click **TX HOLD** again to release PTT.

> **Safety timeout:** If the WebRTC connection drops during TX, PTT is released automatically within 500 ms.

> **RX muting during TX:** While PTT is active, the receive audio is automatically silenced on the server. This eliminates acoustic echo (headphones/speakers → microphone → radio TX) without any additional configuration. RX audio resumes immediately on PTT release.

### DSP on the Pi

Voice audio captured by the microphone is sent to the Pi via WebRTC and processed before reaching the radio. The processing chain applied (in order) is:

| Stage | Type | Parameters |
|---|---|---|
| HPF | High-pass filter | 200 Hz — removes low-frequency noise |
| Bell EQ | Cut | −6 dB @ 350 Hz — reduces male voice boxiness |
| Bell EQ | Boost | +3 dB @ 2200 Hz — improves SSB intelligibility |
| LPF | Low-pass filter | 3200 Hz — standard SSB bandwidth |
| Expander | Downward expander | Reduces level when voice is below threshold (background suppression) |

This processing is always applied when PTT is active, regardless of the monitoring mode selected.

### Audio Settings

The **⚙ Audio** button (or similar) opens a popup with TX audio configuration options:

| Option | Description |
|---|---|
| **Microphone device** | Select the microphone to use for TX |
| **TX Post-DSP Monitor** | See section below |

### TX Post-DSP Monitor

The **TX Post-DSP Monitor** checkbox in the Audio popup lets you hear the exact signal that reached the radio after all DSP processing.

**How it works:**
- During PTT, the Pi streams processed audio frames to the browser via WebSocket (`/ws/tx-monitor`)
- The browser does *not* play them during transmission (which would cause echo)
- When **PTT is released**, the browser immediately plays back all accumulated frames in sequence

**What it is for:**
- Checking transmitted signal quality (EQ, expander level)
- Diagnosing audio problems without needing another operator
- Confirming voice sounds correct before a QSO

> The TX Post-DSP Monitor **does not cause echo** because audio is played back only after PTT is released and the microphone is deactivated.

---

## 7. Waterfall and Spectrum

The waterfall section has two stacked panels:

### Spectrum Panel

Upper panel (80 px tall) — shows energy per frequency in real time, with exponential smoothing. High, colourful peaks indicate active signals.

- **Horizontal axis**: frequency in Hz (within the radio's AF passband)
- **Filled area**: signal energy with colour gradient
- **Outline**: smoothed instantaneous spectrum crest

### AF Waterfall

Lower panel (variable height) — displays the time evolution of the spectrum, with the most recent moment at the top and time scrolling downward.

- **Horizontal axis**: frequency (same scale as spectrum panel)
- **Vertical axis**: time (top = now, bottom = past)
- **Colour**: signal intensity

### Colour Interpretation

| Colour | Intensity | Meaning |
|---|---|---|
| Dark blue / black | Very low | Background noise / no signal |
| Medium blue | Low | Weak signal |
| Cyan / teal | Medium | Moderate signal |
| Yellow / orange | High | Strong signal |
| Red / coral | Very high | Very strong signal |

> **Note on FT-991A:** The waterfall shows the AF spectrum (0–3 kHz for SSB). This is normal behaviour for this radio — the FT-991A does not provide wideband RF spectrum over USB.

---

## 8. DX Cluster and Ruler

The **DX Ruler** is the frequency ruler below the VFO that shows active DX spots on the current band.

- Each coloured mark represents a DX spot with callsign and frequency
- Hovering over a mark shows the spot details
- Clicking a mark tunes the radio to that frequency

> *Feature under development — real-time DX spots via external cluster.*

---

## 9. QSO Log

The **QSO Log** form lets you record completed contacts.

| Field | Description |
|---|---|
| **Call** | Callsign of the contacted station |
| **Freq** | Frequency (auto-filled from VFO) |
| **Mode** | Mode (auto-filled) |
| **Band** | Band (calculated automatically) |
| **RST Sent / Rcvd** | Signal report sent and received |
| **Name** | Operator name |
| **QTH** | Location |
| **Notes** | Free notes |
| **Time** | UTC time (auto-filled) |

Click **Log QSO** to save the record.

---

## 10. Status Indicators

| Indicator | Green / Live | Red / Fault | Grey / Offline |
|---|---|---|---|
| **Connection badge** (top) | Connected and operational | Connection error | Disconnected |
| **Waterfall** (label) | Receiving spectrum | WebSocket error | No connection |
| **TX/RX badge** | TX active (red) / RX (green) | — | — |

---

## 11. Troubleshooting

### No audio after Connect

- Check that the status badge changed to **Live** (not **Fault**)
- Check that the browser volume is not muted
- Try **Disconnect** and **Connect** again
- In some browsers, clicking once on the page before Connect unblocks audio autoplay

### Blank waterfall / "Standby"

- The spectrum requires the backend to be running and receiving audio from the radio
- Check that the radio is powered on and the USB Audio is connected to the server
- Wait a few seconds — the WebSocket reconnects automatically

### Delay when changing frequency

- Normal: < 200 ms
- If longer, may indicate server overload — contact the administrator

### TX not working / no RF signal

- Confirm that mode is USB or LSB (AM/FM/CW modes have restrictions for microphone TX)
- Check that the browser has microphone permission
- Confirm that the antenna is connected to the radio

### Echo reported by the other operator

The system automatically mutes RX audio during TX to eliminate echo. If echo persists:

1. Confirm that **TX Post-DSP Monitor** is disabled during the actual QSO (diagnostic tool only)
2. Check that no other audio device is playing sound near the microphone
3. Disconnect and reconnect the WebRTC session

### TX Post-DSP Monitor produces no audio

- Confirm the checkbox is active before pressing PTT
- Check the browser console (F12 → Console) for "[TX Monitor] primeiro frame"
- Audio is only played **after releasing PTT** — this is expected behaviour

### Browser shows security warning for certificate

- Normal for installations with self-signed certificates
- Click **Advanced** / **Proceed** to accept and continue

---

*For technical questions and server configuration, see [install.md](install.md) and [hardware_requirements.md](hardware_requirements.md).*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
