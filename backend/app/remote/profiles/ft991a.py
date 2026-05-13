from dataclasses import dataclass


@dataclass
class FT991AProfile:
    """Perfil do Yaesu FT-991A.

    Ligação CAT via USB Serial (CP2105 Dual UART) → rigctld :4532.
    A porta série é detectada automaticamente pelo RigctldManager via
    /dev/serial/by-id/ (padrão ``*CP2105*if00*``), ou pode ser configurada
    explicitamente em ``rig.serial_port`` no remote_config.yaml.

    Áudio via USB Audio CODEC (48 kHz, estéreo): canal L = RX, canal R = TX.

    USB: VID=10c4 (Silicon Labs), PID=ea70, interface 0 = CAT, interface 1 = UART2.
    """

    name: str = "Yaesu FT-991A"
    hamlib_model: int = 1035
    # Usar "auto" para detecção automática via /dev/serial/by-id/
    # O RigctldManager resolve o path real antes de arrancar o rigctld.
    default_serial_port: str = "auto"
    default_baud: int = 38400
    # Padrão glob para auto-detecção em /dev/serial/by-id/
    # CP2105 Dual UART: interface 0 = CAT, interface 1 = 2.ª UART.
    # None significa que este rádio não usa porta série USB.
    serial_by_id_pattern: str | None = "*CP2105*if00*"
    rigctld_host: str = "localhost"
    rigctld_port: int = 4532
    audio_device: str = "USB Audio CODEC"
    audio_sample_rate: int = 48000
    # Canal 0 (L) = áudio RX; canal 1 (R) = áudio TX
    audio_rx_channel: int = 0
    audio_tx_channel: int = 1


PROFILE = FT991AProfile()
