<!--
© 2026 Octávio Filipe Gonçalves
Callsign: CT7BFV
License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Last update: 2026-05-13 UTC
-->

# 4HAM Remote Operation — Radio Profiles

Per-radio configuration reference for rigctld, USB Audio, and backend settings.

---

## Table of Contents

1. [Yaesu FT-991A](#1-yaesu-ft-991a)
2. [Xiegu X6100](#2-xiegu-x6100)
3. [Icom IC-7300](#3-icom-ic-7300)
4. [Yaesu FTDX10](#4-yaesu-ftdx10)
5. [Generic Hamlib Radio](#5-generic-hamlib-radio)
6. [Hamlib Model Reference](#6-hamlib-model-reference)

---

## 1. Yaesu FT-991A

Primary development and reference radio for 4HAM Remote Operation.

### Radio setup

In the FT-991A menu, configure:

| Menu item | Setting |
|---|---|
| CAT RATE | 38400 |
| CAT TIME OUT | 1000 ms |
| CAT RTS | DISABLE |
| USB SEND | DAKY |
| USB IN LEVEL | 50 |
| USB OUT LEVEL | 50 |

### USB connections

The FT-991A exposes two USB devices when connected via a single USB cable:

| USB device | VID:PID | ALSA/TTY name | Purpose |
|---|---|---|---|
| CP2105 Dual UART | `10c4:ea70` | `/dev/ttyUSB0` (or ttyUSB1) | CAT (rigctld) |
| PCM2903B Audio | `08bb:29b3` | `USB Audio CODEC` | RX/TX audio |

### rigctld

```bash
rigctld -m 1035 -r /dev/ttyUSB0 -s 38400 -t 4532
```

Verify the correct ttyUSB port:
```bash
ls /dev/ttyUSB*
dmesg | grep cp210x | tail -5
```

### remote_config.yaml

```yaml
rig:
  model: 1035
  port: /dev/ttyUSB0
  baud: 38400
  rigctld_host: 127.0.0.1
  rigctld_port: 4532

audio:
  device: "USB Audio CODEC"
  sample_rate: 48000
  rx_channel: 0
  tx_channel: 1
```

### Known limitations

- **No native wideband spectrum**: USB Audio output is demodulated AF only (0–3 kHz SSB). The waterfall shows AF spectrum only.
- **CAT baud sensitivity**: Must use 38400 exactly. Higher rates are unstable on some FT-991A firmware versions.
- **PTT via CAT only**: Hardware PTT via RTS/CTS is not required; `T` command via rigctld extended protocol is used.

---

## 2. Xiegu X6100

### Radio setup

The X6100 connects via WiFi or Ethernet. No USB required.

Enable network CAT in the X6100 settings menu.

### rigctld

```bash
# replace <x6100-ip> with the actual IP of the X6100 on your LAN
rigctld -m 3087 -r <x6100-ip>:4532 -t 4532
```

### remote_config.yaml

```yaml
rig:
  model: 3087
  port: <x6100-ip>:4532
  baud: 0           # not applicable for network connection
  rigctld_host: 127.0.0.1
  rigctld_port: 4532

audio:
  # X6100 uses network audio — configuration TBD
  device: ""
  sample_rate: 48000
  rx_channel: 0
  tx_channel: 1
```

> Network audio integration for the X6100 is under development.

---

## 3. Icom IC-7300

### Radio setup

In the IC-7300 Set menu:

| Setting | Value |
|---|---|
| USB Baud Rate | 19200 |
| CI-V Baud Rate | Auto |
| CI-V Address | 94h (default) |
| USB MOD Level | 50% |
| USB AF Level | 50% |

### USB connections

| USB device | Purpose |
|---|---|
| USB Serial (CP210x) | CAT via CI-V → `/dev/ttyUSB0` |
| USB Audio | RX/TX audio + IQ output |

### rigctld

```bash
rigctld -m 373 -r /dev/ttyUSB0 -s 19200 -t 4532
```

### remote_config.yaml

```yaml
rig:
  model: 373
  port: /dev/ttyUSB0
  baud: 19200
  rigctld_host: 127.0.0.1
  rigctld_port: 4532

audio:
  device: "USB Audio CODEC"   # verify exact name with sounddevice
  sample_rate: 48000
  rx_channel: 0
  tx_channel: 1
```

### IQ output (wideband spectrum)

The IC-7300 can output IQ data over USB Audio (±48 kHz), enabling native wideband spectrum. This requires selecting the IQ output mode in the radio's USB settings and configuring the `IcomUSBIQSource` spectrum source in the backend (planned feature — see [ROADMAP.md](../ROADMAP.md)).

---

## 4. Yaesu FTDX10

### Radio setup

| Menu item | Setting |
|---|---|
| CAT RATE | 38400 |
| CAT TIME OUT | 1000 ms |

### rigctld

```bash
rigctld -m 1118 -r /dev/ttyUSB0 -s 38400 -t 4532
```

### remote_config.yaml

```yaml
rig:
  model: 1118
  port: /dev/ttyUSB0
  baud: 38400
  rigctld_host: 127.0.0.1
  rigctld_port: 4532

audio:
  device: "USB Audio CODEC"
  sample_rate: 48000
  rx_channel: 0
  tx_channel: 1
```

### Scope data (wideband spectrum)

The FTDX10 has a built-in scope that can output spectrum data. Integration via `YaesuScopeSource` is planned (see [ROADMAP.md](../ROADMAP.md)).

---

## 5. Generic Hamlib Radio

Any radio supported by Hamlib can be used for basic CAT control (frequency, mode, PTT).

1. Find the Hamlib model number for your radio:
   ```bash
   rigctl -l | grep -i <brand>
   ```

2. Find the serial port:
   ```bash
   ls /dev/ttyUSB* /dev/ttyACM*
   dmesg | tail -20
   ```

3. Start rigctld:
   ```bash
   rigctld -m <model> -r <port> -s <baud> -t 4532
   ```

4. Test CAT connection:
   ```bash
   rigctl -m 2 -r localhost:4532 f    # get frequency
   ```

5. Configure `remote_config.yaml` with the appropriate values.

---

## 6. Hamlib Model Reference

Quick reference for common amateur radios:

| Radio | Model ID | Notes |
|---|---|---|
| Yaesu FT-991A | 1035 | |
| Yaesu FT-991 | 1034 | |
| Yaesu FTDX10 | 1118 | |
| Yaesu FTDX101D | 1105 | |
| Yaesu FT-817ND | 1020 | |
| Icom IC-7300 | 373 | |
| Icom IC-7610 | 3070 | |
| Icom IC-9700 | 3080 | |
| Kenwood TS-890S | 2050 | |
| Xiegu X6100 | 3087 | Network CAT |
| Elecraft K4 | 2065 | |

Full list: `rigctl -l` or [https://hamlib.github.io/](https://hamlib.github.io/)

---

*See [hardware_requirements.md](hardware_requirements.md) for hardware setup and [install.md](install.md) for installation.*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
