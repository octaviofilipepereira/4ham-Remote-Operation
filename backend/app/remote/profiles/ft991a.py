from dataclasses import dataclass


@dataclass
class FT991AProfile:
    """Perfil do Yaesu FT-991A.

    Ligação CAT via USB Serial → rigctld :4532.
    Áudio via USB Audio CODEC (48 kHz, estéreo): canal L = RX, canal R = TX.
    """

    name: str = "Yaesu FT-991A"
    hamlib_model: int = 1035
    default_serial_port: str = "/dev/ttyUSB0"
    default_baud: int = 38400
    rigctld_host: str = "localhost"
    rigctld_port: int = 4532
    audio_device: str = "USB Audio CODEC"
    audio_sample_rate: int = 48000
    # Canal 0 (L) = áudio RX; canal 1 (R) = áudio TX
    audio_rx_channel: int = 0
    audio_tx_channel: int = 1


PROFILE = FT991AProfile()
