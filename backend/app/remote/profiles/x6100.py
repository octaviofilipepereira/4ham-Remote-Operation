from dataclasses import dataclass, field


@dataclass
class X6100Profile:
    """Perfil do Xiegu X6100.

    Ligação CAT via WiFi/Ethernet nativo → rigctld.
    Áudio nativo via rede (protocolo wfview ou USB Audio se ligado por USB).
    Quando audio_device = "" utiliza o áudio de rede nativo do rádio.
    """

    name: str = "Xiegu X6100"
    hamlib_model: int = 3087
    default_baud: int = 115200
    # X6100 liga via rede — não usa porta série USB.
    default_serial_port: str | None = None
    # Padrão glob para /dev/serial/by-id/ — None porque a ligação é por rede.
    serial_by_id_pattern: str | None = None
    rigctld_host: str = "192.168.1.100"   # endereço IP do X6100, configurável
    rigctld_port: int = 4532
    # Deixar vazio para usar áudio de rede nativo; preencher para USB Audio
    audio_device: str = ""
    audio_sample_rate: int = 48000
    audio_rx_channel: int = 0
    audio_tx_channel: int = 0

    # ── Capacidades RF ────────────────────────────────────────────
    # X6100: ATT de 20 dB (passo único)
    att_steps: list[int] = field(default_factory=lambda: [0, 20])
    # X6100: apenas pré-amplificador ON/OFF (0=OFF, 10=ON)
    preamp_steps: list[int] = field(default_factory=lambda: [0, 10])
    preamp_labels: dict = field(default_factory=lambda: {"0": "OFF", "10": "ON"})
    agc_modes: list[str] = field(default_factory=lambda: ["FAST", "MID", "SLOW"])


PROFILE = X6100Profile()
