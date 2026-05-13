import asyncio
import logging
import socket
import struct

logger = logging.getLogger(__name__)

_RECONNECT_BASE: float = 1.0   # segundos
_RECONNECT_MAX: float  = 30.0  # segundos
_CMD_TIMEOUT: float    = 5.0   # segundos


def _set_linger_zero(writer: asyncio.StreamWriter) -> None:
    """Activa SO_LINGER com l_linger=0: ao fechar envia RST em vez de FIN.

    Isto garante que o rigctld limpa imediatamente o socket do seu lado,
    evitando a acumulação de ligações CLOSE-WAIT.
    """
    try:
        sock = writer.get_extra_info("socket")
        if sock is not None:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                            struct.pack("ii", 1, 0))
    except Exception:
        pass  # ignorar — sem impacto funcional


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

    Usa DUAS ligações TCP separadas ao rigctld:

    • Ligação de escrita (_lock + _reader/_writer):
      Usada exclusivamente por set_freq, set_mode, set_ptt.
      O lock é adquirido por breves instantes (~50ms por comando).

    • Ligação de leitura (_poll_lock + _poll_r/_poll_w):
      Usada exclusivamente por get_status (polling de 4 comandos em pipeline).
      Pode demorar 200-800ms (4 RTTs de série ao rádio) sem bloquear as escritas.

    Desta forma, mudar a frequência nunca fica bloqueado pelo polling de status.
    """

    def __init__(self, host: str = "localhost", port: int = 4532) -> None:
        self.host = host
        self.port = port

        # Ligação de escrita (set_*)
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()
        self._reconnect_delay = _RECONNECT_BASE

        # Ligação de leitura (get_status)
        self._poll_r: asyncio.StreamReader | None = None
        self._poll_w: asyncio.StreamWriter | None = None
        self._poll_lock = asyncio.Lock()
        self._poll_reconnect_delay = _RECONNECT_BASE

    # ── ligações ─────────────────────────────────────────────────────────────

    async def connect(self) -> None:
        """Abre a ligação de escrita."""
        self._reader, self._writer = await asyncio.open_connection(self.host, self.port)
        _set_linger_zero(self._writer)
        self._reconnect_delay = _RECONNECT_BASE
        logger.info("rigctld (escrita) ligado em %s:%s", self.host, self.port)

    async def _connect_poll(self) -> None:
        """Abre a ligação de leitura (polling)."""
        self._poll_r, self._poll_w = await asyncio.open_connection(self.host, self.port)
        _set_linger_zero(self._poll_w)
        self._poll_reconnect_delay = _RECONNECT_BASE
        logger.info("rigctld (leitura) ligado em %s:%s", self.host, self.port)

    async def _ensure_connected(self) -> None:
        while self._writer is None or self._writer.is_closing():
            try:
                await self.connect()
            except OSError as exc:
                logger.warning("rigctld (escrita) indisponível (%s) — %.1fs", exc, self._reconnect_delay)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, _RECONNECT_MAX)

    async def _ensure_poll_connected(self) -> None:
        while self._poll_w is None or self._poll_w.is_closing():
            try:
                await self._connect_poll()
            except OSError as exc:
                logger.warning("rigctld (leitura) indisponível (%s) — %.1fs", exc, self._poll_reconnect_delay)
                await asyncio.sleep(self._poll_reconnect_delay)
                self._poll_reconnect_delay = min(self._poll_reconnect_delay * 2, _RECONNECT_MAX)

    async def close(self) -> None:
        for w in (self._writer, self._poll_w):
            if w and not w.is_closing():
                w.close()
                try:
                    await asyncio.wait_for(w.wait_closed(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass
        self._reader = self._writer = None
        self._poll_r = self._poll_w = None

    # ── protocolo rigctld (modo extendido) ───────────────────────────────────

    @staticmethod
    async def _read_response(reader: asyncio.StreamReader) -> list[str]:
        """Lê linhas até RPRT 0; devolve lista de valores (sem cabeçalho)."""
        lines: list[str] = []
        header_skipped = False
        while True:
            raw = await asyncio.wait_for(reader.readline(), _CMD_TIMEOUT)
            if not raw:
                raise ConnectionResetError("rigctld fechou a ligação")
            text = raw.decode().rstrip("\r\n")
            if text.startswith("RPRT"):
                code = int(text.split()[1])
                if code != 0:
                    raise RuntimeError(f"rigctld RPRT {code}")
                return lines
            if not header_skipped:
                header_skipped = True
                continue
            if text:
                lines.append(text.split(": ", 1)[1] if ": " in text else text)

    async def _cmd(self, cmd: str) -> list[str]:
        """Envia comando na ligação de ESCRITA (set_*)."""
        async with self._lock:
            await self._ensure_connected()
            try:
                assert self._writer is not None and self._reader is not None
                self._writer.write(("+" + cmd + "\n").encode())
                await self._writer.drain()
                return await self._read_response(self._reader)
            except (OSError, ConnectionResetError, asyncio.TimeoutError) as exc:
                logger.warning("falha no comando '%s': %s — a reconectar", cmd, exc)
                if self._writer and not self._writer.is_closing():
                    self._writer.close()
                self._reader = self._writer = None
                raise

    # ── API pública ──────────────────────────────────────────────────────────

    async def set_freq(self, freq_hz: int) -> None:
        await self._cmd(f"F {freq_hz}")

    async def set_mode(self, mode: str, passband_hz: int = 0) -> None:
        await self._cmd(f"M {mode} {passband_hz}")

    async def set_ptt(self, enabled: bool) -> None:
        await self._cmd(f"T {1 if enabled else 0}")

    async def get_freq(self) -> int:
        lines = await self._cmd("f")
        return int(lines[0])

    async def get_mode(self) -> tuple[str, int]:
        lines = await self._cmd("m")
        return lines[0], (int(lines[1]) if len(lines) > 1 else 0)

    async def get_level(self, level_name: str = "STRENGTH") -> float:
        lines = await self._cmd(f"l {level_name}")
        return float(lines[0])

    async def get_ptt(self) -> bool:
        lines = await self._cmd("t")
        return lines[0].strip() == "1"

    async def get_status(self) -> RigStatus:
        """Polling de status via ligação DEDICADA (não bloqueia set_freq).

        Envia 4 comandos em pipeline e lê as 4 respostas dentro do _poll_lock,
        independente do _lock usado pelos set_*. Assim set_freq nunca espera
        pelo polling de status.
        """
        async with self._poll_lock:
            await self._ensure_poll_connected()
            try:
                assert self._poll_w is not None and self._poll_r is not None
                self._poll_w.write(b"+f\n+m\n+l STRENGTH\n+t\n")
                await self._poll_w.drain()
                freq_l, mode_l, strength_l, ptt_l = [
                    await self._read_response(self._poll_r) for _ in range(4)
                ]
            except (OSError, ConnectionResetError, asyncio.TimeoutError) as exc:
                logger.warning("falha no get_status: %s — a reconectar", exc)
                if self._poll_w and not self._poll_w.is_closing():
                    self._poll_w.close()
                self._poll_r = self._poll_w = None
                raise

        return RigStatus(
            frequency_hz=int(freq_l[0]),
            mode=mode_l[0],
            passband_hz=int(mode_l[1]) if len(mode_l) > 1 else 0,
            strength_db=float(strength_l[0]),
            ptt=ptt_l[0].strip() == "1",
        )
