import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.prefs import router as prefs_router
from .api.qso import router as qso_router
from .api.rig import router as rig_router
from .api.webrtc import router as webrtc_router
from .core.auth_middleware import BasicAuthMiddleware
from .remote.audio_capture import AudioCaptureService
from .remote.audio_tx import AudioTxService
from .remote.cat_driver import CATDriver
from .remote.profiles import load_profile
from .remote.rigctld_manager import RigctldManager, detect_serial_port
from .remote.webrtc_peer import WebRTCPeer
from .websocket.spectrum import router as spectrum_router
from .websocket.tx_monitor import router as tx_monitor_router

logger = logging.getLogger(__name__)

_CONFIG_PATH = os.getenv("REMOTE_CONFIG", "config/remote_config.yaml")


def _load_config() -> dict:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.warning("Ficheiro de config não encontrado (%s) — a usar defaults", _CONFIG_PATH)
        return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = _load_config()

    rig_cfg = cfg.get("rig", {})
    rigctld_cfg = rig_cfg.get("rigctld", {})
    rigctld_host = os.getenv("RIGCTLD_HOST", rigctld_cfg.get("host", "127.0.0.1"))
    rigctld_port = int(os.getenv("RIGCTLD_PORT", rigctld_cfg.get("port", 4532)))

    # ── Carregar o perfil activo ──────────────────────────────────────────────
    # O perfil define os defaults de hardware (hamlib_model, baud,
    # padrão de detecção USB).  O config pode sobrepor qualquer destes valores.
    profile_name = rig_cfg.get("profile", "ft991a")
    profile = load_profile(profile_name)
    if profile is None:
        logger.error(
            "Perfil '%s' não foi carregado — verifique rig.profile no config",
            profile_name,
        )

    profile_hamlib_model = getattr(profile, "hamlib_model", 1035)
    profile_baud = getattr(profile, "default_baud", 38400)
    profile_serial_pattern = getattr(profile, "serial_by_id_pattern", None)
    profile_default_port = getattr(profile, "default_serial_port", None)

    # ── Arranque automático do rigctld ────────────────────────────────────────
    # Prioridade: variável de ambiente > config > default do perfil
    serial_port_cfg = os.getenv(
        "RIG_SERIAL_PORT",
        rig_cfg.get("serial_port", profile_default_port or "auto"),
    )
    serial_port = detect_serial_port(
        explicit_port=serial_port_cfg,
        by_id_pattern=profile_serial_pattern,
        radio_name=getattr(profile, "name", profile_name),
    )

    rigctld_manager: RigctldManager | None = None
    if serial_port:
        rigctld_manager = RigctldManager(
            serial_port=serial_port,
            hamlib_model=int(rig_cfg.get("hamlib_model", profile_hamlib_model)),
            baud=int(rig_cfg.get("baud", profile_baud)),
            listen_host=rigctld_host,
            listen_port=rigctld_port,
        )
        await rigctld_manager.start()
    else:
        logger.warning(
            "Porta série não detectada para o perfil '%s' — "
            "o rigctld terá de estar a correr manualmente",
            profile_name,
        )

    app.state.rigctld_manager = rigctld_manager
    app.state.rigctld_host    = rigctld_host
    app.state.rigctld_port    = rigctld_port
    app.state.rig_serial_port = serial_port
    app.state.rig_profile             = profile
    app.state.rig_profile_name        = profile_name
    app.state.rig_profile_hamlib_model = int(rig_cfg.get("hamlib_model", profile_hamlib_model))
    app.state.rig_profile_baud         = int(rig_cfg.get("baud", profile_baud))

    driver = CATDriver(
        host=rigctld_host,
        port=rigctld_port,
    )
    app.state.cat_driver = driver
    # Não tentamos conectar no arranque: o rádio pode estar desligado.
    # A ligação é feita de forma lazy no primeiro comando CAT,
    # ou explicitamente via POST /api/rig/connect.

    audio_cfg = cfg.get("audio", {})
    audio_source = AudioCaptureService(
        device=os.getenv("AUDIO_DEVICE") or audio_cfg.get("device") or None,
        rx_channel=int(os.getenv("AUDIO_RX_CHANNEL", audio_cfg.get("rx_channel", 0))),
        rx_gain=float(os.getenv("AUDIO_RX_GAIN", audio_cfg.get("rx_gain", 1.0))),
    )
    app.state.audio_capture = audio_source

    audio_tx = AudioTxService(
        device=os.getenv("AUDIO_DEVICE") or audio_cfg.get("device") or None,
        tx_channel=int(os.getenv("AUDIO_TX_CHANNEL", audio_cfg.get("tx_channel", 1))),
    )
    app.state.audio_tx = audio_tx

    ptt_cfg = cfg.get("ptt", {})
    app.state.ptt_allowed_bands = ptt_cfg.get("allowed_bands", [])
    app.state.ptt_max_tx_seconds = int(ptt_cfg.get("max_tx_seconds", 180))
    app.state.tx_timer = None

    peer = WebRTCPeer(
        audio_source=audio_source,
        audio_tx=audio_tx,
        cat_driver=driver,
    )
    app.state.webrtc_peer = peer

    # ── Fonte de espectro (audio_fft ou rtlsdr) ───────────────────────────────
    spectrum_cfg = cfg.get("spectrum", {})
    source_type = spectrum_cfg.get("source", "audio_fft")
    if source_type == "rtlsdr":
        from .dsp.rtlsdr_source import RTLSDRSource, _HAS_RTLSDR
        if _HAS_RTLSDR:
            rtlsdr_cfg = spectrum_cfg.get("rtlsdr", {})
            spectrum_source = RTLSDRSource(
                cat_driver=driver,
                device_index=int(rtlsdr_cfg.get("device_index", 0)),
                sample_rate=int(rtlsdr_cfg.get("sample_rate", 250000)),
                ppm=int(rtlsdr_cfg.get("ppm_correction", 0)),
                gain=float(rtlsdr_cfg.get("gain", 30.0)),
                span_hz=int(rtlsdr_cfg.get("span_hz", 100000)),
            )
            logger.info("Fonte de espectro: RTL-SDR (device_index=%d)", rtlsdr_cfg.get("device_index", 0))
        else:
            logger.warning(
                "spectrum.source=rtlsdr configurado mas pyrtlsdr não está instalado — "
                "a usar AudioFFTSource como substituto"
            )
            from .dsp.spectrum_source import AudioFFTSource
            spectrum_source = AudioFFTSource(audio_source)
    else:
        from .dsp.spectrum_source import AudioFFTSource
        spectrum_source = AudioFFTSource(audio_source)
        logger.info("Fonte de espectro: AudioFFT (AF do rádio)")

    app.state.spectrum_source = spectrum_source

    # ── Log de QSOs (memória + persistência em JSONL) ─────────────────────────
    import json
    from collections import deque
    qso_log_path = Path("data/qso_log.jsonl")
    qso_deque: deque = deque(maxlen=100)
    if qso_log_path.exists():
        try:
            lines = qso_log_path.read_text(encoding="utf-8").strip().splitlines()
            for line in reversed(lines[-100:]):
                try:
                    qso_deque.appendleft(json.loads(line))
                except Exception:
                    pass
            logger.info("Log de QSOs: %d entradas carregadas de %s", len(qso_deque), qso_log_path)
        except OSError as exc:
            logger.warning("Não foi possível carregar log de QSOs: %s", exc)
    app.state.qso_log = qso_deque

    yield

    await peer.close()
    await audio_source.close()
    audio_tx.stop()
    await driver.close()
    await spectrum_source.stop()
    if rigctld_manager:
        await rigctld_manager.stop()


def create_app() -> FastAPI:
    cfg = _load_config()
    users = cfg.get("auth", {}).get("users", [])

    app = FastAPI(
        title="4ham Remote Operation",
        description="Operação remota de estação de rádio amador via browser",
        version="0.1.0",
        lifespan=lifespan,
    )

    if users:
        app.add_middleware(BasicAuthMiddleware, users=users)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # restringir em produção via config
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(rig_router)
    app.include_router(qso_router)
    app.include_router(webrtc_router)
    app.include_router(spectrum_router)
    app.include_router(tx_monitor_router)
    app.include_router(prefs_router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    # servir o frontend estático se a pasta existir
    # main.py está em backend/app/ — três .parent sobem para a raiz do projecto
    frontend_path = Path(__file__).resolve().parent.parent.parent / "frontend"
    if frontend_path.is_dir():
        app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")

    return app


app = create_app()
