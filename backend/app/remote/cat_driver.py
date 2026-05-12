import asyncio
import logging

logger = logging.getLogger(__name__)

_RECONNECT_BASE: float = 1.0   # segundos
_RECONNECT_MAX: float  = 30.0  # segundos
_CMD_TIMEOUT: float    = 5.0   # segundos


class RigStatus:
    __slots__ = ("frequency_hz", "mode", "passband_hz", "strength_db", "ptt")

    def __init__(
        self,
        frequency_hz: int,
        mode: str,
        passband_hz: int,
        strength_db: float,
        ptt: bool,
    ) -> None:
        self.frequency_hz = frequency_hz
        self.mode = mode
        self.passband_hz = passband_hz
        self.strength_db = strength_db
        self.ptt = ptt


class CATDriver:
    """Cliente async para rigctld via TCP.

    Liga ao rigctld no *host*:*port* especificado.
    Reconecta automaticamente com backoff exponencial se a ligação cair.
    Todos os métodos públicos são thread-safe via asyncio.Lock.
    """

    def __init__(self, host: str = "localhost", port: int = 4532) -> None:
        self.host = host
        self.port = port
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()
        self._reconnect_delay = _RECONNECT_BASE

    # ── ligação ──────────────────────────────────────────────────────────────

    async def connect(self) -> None:
        self._reader, self._writer = await asyncio.open_connection(self.host, self.port)
        self._reconnect_delay = _RECONNECT_BASE
        logger.info("rigctld ligado em %s:%s", self.host, self.port)

    async def _ensure_connected(self) -> None:
        while self._writer is None or self._writer.is_closing():
            try:
                await self.connect()
            except OSError as exc:
                logger.warning(
                    "rigctld indisponível (%s) — nova tentativa em %.1fs",
                    exc,
                    self._reconnect_delay,
                )
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, _RECONNECT_MAX)

    async def close(self) -> None:
        if self._writer and not self._writer.is_closing():
            self._writer.close()
            try:
                await asyncio.wait_for(self._writer.wait_closed(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
        self._reader = None
        self._writer = None

    # ── protocolo rigctld ────────────────────────────────────────────────────

    async def _cmd(self, cmd: str) -> list[str]:
        """Envia *cmd* no protocolo extendido rigctld (prefixo '+').

        Formato de resposta extendida:
          <command_name>: [params]  ← linha de cabeçalho (ignorada)
          [Key: Value | valor_raw]  ← linhas de dados (0 ou mais)
          RPRT <código>             ← terminador

        Devolve lista dos *valores* extraídos (sem chaves nem cabeçalho).
        """
        async with self._lock:
            await self._ensure_connected()
            try:
                assert self._writer is not None
                assert self._reader is not None
                self._writer.write(("+" + cmd + "\n").encode())
                await self._writer.drain()
                lines: list[str] = []
                header_skipped = False
                while True:
                    raw = await asyncio.wait_for(self._reader.readline(), _CMD_TIMEOUT)
                    if not raw:
                        raise ConnectionResetError("rigctld fechou a ligação")
                    text = raw.decode().rstrip("\r\n")
                    if text.startswith("RPRT"):
                        code = int(text.split()[1])
                        if code != 0:
                            raise RuntimeError(f"rigctld RPRT {code} para '{cmd}'")
                        return lines
                    if not header_skipped:
                        # Primeira linha é sempre o cabeçalho (ex: "get_freq:" ou "get_level: STRENGTH")
                        header_skipped = True
                        continue
                    if text:
                        # Linhas de dados: "Key: Value" ou valor raw (ex: "-44")
                        if ": " in text:
                            lines.append(text.split(": ", 1)[1])
                        else:
                            lines.append(text)
            except (OSError, ConnectionResetError, asyncio.TimeoutError) as exc:
                logger.warning("falha no comando '%s': %s — a reconectar", cmd, exc)
                await self.close()
                raise

    # ── API pública ──────────────────────────────────────────────────────────

    async def get_freq(self) -> int:
        lines = await self._cmd("f")
        return int(lines[0])

    async def set_freq(self, freq_hz: int) -> None:
        await self._cmd(f"F {freq_hz}")

    async def get_mode(self) -> tuple[str, int]:
        lines = await self._cmd("m")
        mode = lines[0]
        passband = int(lines[1]) if len(lines) > 1 else 0
        return mode, passband

    async def set_mode(self, mode: str, passband_hz: int = 0) -> None:
        await self._cmd(f"M {mode} {passband_hz}")

    async def get_level(self, level_name: str = "STRENGTH") -> float:
        lines = await self._cmd(f"l {level_name}")
        return float(lines[0])

    async def get_ptt(self) -> bool:
        lines = await self._cmd("t")
        return lines[0].strip() == "1"

    async def set_ptt(self, enabled: bool) -> None:
        await self._cmd(f"T {1 if enabled else 0}")

    async def get_status(self) -> RigStatus:
        freq               = await self.get_freq()
        mode, passband     = await self.get_mode()
        strength           = await self.get_level("STRENGTH")
        ptt                = await self.get_ptt()
        return RigStatus(
            frequency_hz=freq,
            mode=mode,
            passband_hz=passband,
            strength_db=strength,
            ptt=ptt,
        )
