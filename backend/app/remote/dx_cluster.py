"""
DX Cluster client — ligação asyncio Telnet a um cluster DX Spider / AR-Cluster.

Responsabilidades:
  - Ligar/religar automaticamente ao cluster configurado (reconnect a cada 30 s).
  - Fazer login com o callsign do operador.
  - Fazer parse de linhas DX Spider e AR-Cluster.
  - Manter uma fila circular de MAX_SPOTS spots, expirando entradas com
    mais de max_spot_age_min minutos.
  - Expor estado e spots via atributos públicos (thread-safe com asyncio).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)

MAX_SPOTS       = 500
RECONNECT_DELAY = 30   # segundos entre tentativas de reconexão
LOGIN_TIMEOUT   = 15   # segundos para esperar pelo prompt de login
READ_TIMEOUT    = 120  # segundos sem dados antes de considerar a ligação morta

# ── Regex para linha DX Spider / AR-Cluster ────────────────────────────────
# Formato: DX de SPOTTER:  FREQ    DXCALL    COMMENT                  HHMM Z
# Nota: alguns nós (ex. CS5SEL-5/ISEL) enviam apenas 1 espaço antes da hora
# quando o comentário termina com um localizador (ex. "JN41 1702Z"). Por isso
# usa-se \s+ em vez de \s{2,}.
_DX_RE = re.compile(
    r"DX\s+de\s+(\S+?)\s*:?\s*([\d.]+)\s+(\S+)\s*(.*?)\s+(\d{4})Z",
    re.IGNORECASE,
)

# ── Banda a partir de frequência (Hz) ─────────────────────────────────────
_BAND_MAP = [
    (1_800_000,   2_000_000,  "160m"),
    (3_500_000,   3_800_000,  "80m"),
    (5_351_500,   5_366_500,  "60m"),
    (7_000_000,   7_200_000,  "40m"),
    (10_100_000,  10_150_000, "30m"),
    (14_000_000,  14_350_000, "20m"),
    (18_068_000,  18_168_000, "17m"),
    (21_000_000,  21_450_000, "15m"),
    (24_890_000,  24_990_000, "12m"),
    (28_000_000,  29_700_000, "10m"),
    (50_000_000,  54_000_000, "6m"),
    (144_000_000, 148_000_000,"2m"),
    (430_000_000, 440_000_000,"70cm"),
]


def _freq_to_band(freq_hz: float) -> str:
    for lo, hi, label in _BAND_MAP:
        if lo <= freq_hz <= hi:
            return label
    return "other"


class ClusterState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING   = "connecting"
    CONNECTED    = "connected"
    ERROR        = "error"


@dataclass
class DXSpot:
    spotter:   str
    dx_call:   str
    freq_hz:   float
    band:      str
    comment:   str
    utc_time:  str          # "HHMM" como veio do cluster
    received_at: float = field(default_factory=time.time)


@dataclass
class ClusterConfig:
    host:             str
    port:             int  = 7300
    callsign:         str  = "CT7BFV"
    max_spot_age_min: int  = 60


class DXClusterClient:
    """Cliente asyncio para um nó DX Cluster (DX Spider / AR-Cluster)."""

    def __init__(self, host: str, port: int, callsign: str,
                 max_spot_age_min: int = 60) -> None:
        self._cfg = ClusterConfig(
            host=host,
            port=port,
            callsign=callsign,
            max_spot_age_min=max_spot_age_min,
        )
        self._spots: deque[DXSpot] = deque(maxlen=MAX_SPOTS)
        self._state: ClusterState  = ClusterState.DISCONNECTED
        self._error: Optional[str] = None
        self._task:  Optional[asyncio.Task] = None
        self._connected_at: Optional[float] = None

    # ── Propriedades públicas ──────────────────────────────────────────────

    @property
    def state(self) -> ClusterState:
        return self._state

    @property
    def config(self) -> ClusterConfig:
        return self._cfg

    @property
    def error(self) -> Optional[str]:
        return self._error

    def spots(self, band: Optional[str] = None, limit: int = 50) -> list[dict]:
        """Devolver spots recentes, filtrados por banda e sem spots expirados."""
        cutoff = time.time() - self._cfg.max_spot_age_min * 60
        result = [
            s for s in self._spots
            if s.received_at >= cutoff and (band is None or s.band == band)
        ]
        # Mais recentes primeiro
        result.sort(key=lambda s: s.received_at, reverse=True)
        return [
            {
                "spotter":     s.spotter,
                "dx_call":     s.dx_call,
                "freq_hz":     s.freq_hz,
                "band":        s.band,
                "comment":     s.comment,
                "utc_time":    s.utc_time,
                "received_at": s.received_at,
            }
            for s in result[:limit]
        ]

    def status(self) -> dict:
        return {
            "state":        self._state.value,
            "host":         self._cfg.host,
            "port":         self._cfg.port,
            "callsign":     self._cfg.callsign,
            "spot_count":   len(self._spots),
            "connected_at": self._connected_at,
            "error":        self._error,
        }

    # ── Ciclo de vida ──────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop(), name="dx_cluster")
        logger.info("[DXCluster] Arranque agendado para %s:%d (callsign=%s)",
                    self._cfg.host, self._cfg.port, self._cfg.callsign)

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._state = ClusterState.DISCONNECTED
        logger.info("[DXCluster] Parado.")

    async def reconfigure(self, host: str, port: int, callsign: str,
                          max_spot_age_min: int = 60) -> None:
        """Parar, actualizar configuração e reiniciar."""
        await self.stop()
        self._cfg = ClusterConfig(
            host=host, port=port,
            callsign=callsign,
            max_spot_age_min=max_spot_age_min,
        )
        self._spots.clear()
        self._error = None
        await self.start()

    # ── Loop principal com reconexão automática ────────────────────────────

    async def _run_loop(self) -> None:
        while True:
            try:
                await self._connect_and_read()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._state = ClusterState.ERROR
                self._error = str(exc)
                logger.warning("[DXCluster] Erro: %s — a tentar novamente em %ds",
                               exc, RECONNECT_DELAY)
            await asyncio.sleep(RECONNECT_DELAY)

    async def _connect_and_read(self) -> None:
        self._state = ClusterState.CONNECTING
        self._error = None
        logger.info("[DXCluster] A ligar a %s:%d …", self._cfg.host, self._cfg.port)

        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(self._cfg.host, self._cfg.port),
            timeout=LOGIN_TIMEOUT,
        )
        try:
            # Aguardar prompt de login (geralmente "login:" ou "callsign:")
            await asyncio.wait_for(
                self._wait_for_prompt(reader, (b"login", b"call", b">")),
                timeout=LOGIN_TIMEOUT,
            )
            # Enviar callsign
            writer.write((self._cfg.callsign + "\r\n").encode())
            await writer.drain()

            self._state      = ClusterState.CONNECTED
            self._connected_at = time.time()
            logger.info("[DXCluster] Ligado e autenticado como %s", self._cfg.callsign)

            # Leitura contínua de spots
            while True:
                try:
                    line_bytes = await asyncio.wait_for(
                        reader.readline(), timeout=READ_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    logger.warning("[DXCluster] Timeout de leitura — a reconectar")
                    return
                if not line_bytes:
                    logger.info("[DXCluster] Ligação fechada pelo servidor")
                    return
                line = line_bytes.decode("utf-8", errors="replace").strip()
                self._parse_line(line)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if self._state != ClusterState.DISCONNECTED:
                self._state = ClusterState.ERROR
                self._connected_at = None

    @staticmethod
    async def _wait_for_prompt(reader: asyncio.StreamReader,
                               keywords: tuple[bytes, ...]) -> None:
        """Ler até encontrar uma das palavras-chave no stream."""
        buf = b""
        while True:
            chunk = await reader.read(256)
            if not chunk:
                raise ConnectionError("Ligação fechada antes do prompt de login")
            buf += chunk
            buf_lower = buf.lower()
            if any(kw in buf_lower for kw in keywords):
                return
            # Evitar buffer ilimitado: manter apenas os últimos 1024 bytes
            if len(buf) > 1024:
                buf = buf[-1024:]

    # ── Parse de linhas ────────────────────────────────────────────────────

    def _parse_line(self, line: str) -> None:
        m = _DX_RE.search(line)
        if not m:
            return
        spotter, freq_str, dx_call, comment, utc_time = m.groups()
        try:
            freq_hz = float(freq_str) * 1000  # kHz → Hz
        except ValueError:
            return

        spot = DXSpot(
            spotter    = spotter.upper(),
            dx_call    = dx_call.upper(),
            freq_hz    = freq_hz,
            band       = _freq_to_band(freq_hz),
            comment    = comment.strip(),
            utc_time   = utc_time,
        )
        self._spots.append(spot)
        logger.debug("[DXCluster] Spot: %s @ %.1f kHz por %s",
                     spot.dx_call, freq_hz / 1000, spot.spotter)
