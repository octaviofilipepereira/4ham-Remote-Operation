# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

"""RTLSDRSource — espectro RF wideband via dongle RTL-SDR.

Requer:
  - Driver rtl-sdr instalado no sistema (pacote apt ou compilado)
  - Python binding pyrtlsdr (pip install pyrtlsdr)
  - Utilizador no grupo plugdev (acesso USB sem sudo)

Configuração (remote_config.yaml):
  spectrum:
    source: rtlsdr
    rtlsdr:
      device_index: 0       # índice do dongle (0 para o primeiro)
      sample_rate: 250000   # Hz (mínimo 225001 Hz)
      ppm_correction: 0     # correcção de frequência em PPM
      gain: 30.0            # ganho em dB (0 = auto)
      span_hz: 100000       # span visível centrado no VFO (informativo)
"""
from __future__ import annotations

import asyncio
import logging

import numpy as np

from .spectrum_source import SpectrumFrame

logger = logging.getLogger(__name__)

try:
    from rtlsdr import RtlSdr
    _HAS_RTLSDR = True
except ImportError:
    _HAS_RTLSDR = False
    logger.warning(
        "pyrtlsdr não instalado — RTLSDRSource indisponível. "
        "Para instalar: pip install pyrtlsdr"
    )

_FRAME_INTERVAL_S = 0.10    # ~10 fps
_FFT_SIZE = 2048
_FREQ_POLL_INTERVAL = 20    # ciclos (20 × 0.1s = 2s entre actualizações do VFO)


class RTLSDRSource:
    """Fonte de espectro RF: IQ via RTL-SDR, centrado no VFO actual do rádio.

    A frequência do SDR acompanha o VFO do rádio consultando o CATDriver
    de 2 em 2 segundos.

    O span total é igual a sample_rate Hz (centrado no VFO).
    Para sample_rate=250000 → span de ±125 kHz.
    """

    def __init__(
        self,
        cat_driver,
        device_index: int = 0,
        sample_rate: int = 250000,
        ppm: int = 0,
        gain: float = 30.0,
        span_hz: int = 100000,
    ) -> None:
        self._cat = cat_driver
        self._device_index = device_index
        self._sample_rate = sample_rate
        self._ppm = ppm
        self._gain = gain
        self._span_hz = span_hz
        self._queues: list[asyncio.Queue[SpectrumFrame]] = []
        self._task: asyncio.Task | None = None
        self._sdr = None

    async def start(self) -> None:
        """Inicia o loop de captura (chamado implicitamente em subscribe)."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Para o loop de captura e fecha o dongle RTL-SDR."""
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._close_sdr()

    async def subscribe(self, maxsize: int = 8) -> asyncio.Queue[SpectrumFrame]:
        if not _HAS_RTLSDR:
            raise RuntimeError(
                "pyrtlsdr não instalado — RTL-SDR indisponível. "
                "Verifique se o pacote pyrtlsdr está instalado no venv."
            )
        q: asyncio.Queue[SpectrumFrame] = asyncio.Queue(maxsize=maxsize)
        self._queues.append(q)
        if self._task is None or self._task.done():
            await self.start()
        return q

    async def unsubscribe(self, queue: asyncio.Queue[SpectrumFrame]) -> None:
        try:
            self._queues.remove(queue)
        except ValueError:
            pass
        if not self._queues:
            await self.stop()

    async def _close_sdr(self) -> None:
        if self._sdr is not None:
            try:
                self._sdr.close()
            except Exception:
                pass
            self._sdr = None

    async def _get_vfo_hz(self) -> int:
        try:
            status = await self._cat.get_status()
            return int(status.frequency_hz)
        except Exception:
            logger.warning("RTLSDRSource: não foi possível ler VFO do CAT — usando 14 MHz")
            return 14_000_000

    async def _run(self) -> None:
        loop = asyncio.get_event_loop()
        try:
            logger.info(
                "RTLSDRSource: a abrir dongle índice %d (SR=%d Hz, ganho=%.1f dB, PPM=%d)",
                self._device_index, self._sample_rate, self._gain, self._ppm,
            )
            self._sdr = RtlSdr(device_index=self._device_index)
            self._sdr.sample_rate = self._sample_rate
            self._sdr.set_freq_correction(self._ppm)
            self._sdr.gain = self._gain

            current_freq = await self._get_vfo_hz()
            self._sdr.center_freq = current_freq
            logger.info("RTLSDRSource: centrado em %.3f MHz", current_freq / 1e6)

            freq_poll_counter = 0
            window = np.blackman(_FFT_SIZE).astype(np.float32)

            while True:
                # Actualizar frequência do VFO a cada ~2 s
                freq_poll_counter += 1
                if freq_poll_counter >= _FREQ_POLL_INTERVAL:
                    freq_poll_counter = 0
                    new_freq = await self._get_vfo_hz()
                    if abs(new_freq - current_freq) > 1000:
                        self._sdr.center_freq = new_freq
                        current_freq = new_freq
                        logger.debug(
                            "RTLSDRSource: frequência actualizada para %.3f MHz",
                            current_freq / 1e6,
                        )

                # Ler amostras IQ em executor para não bloquear o event loop
                num_samples = _FFT_SIZE * 2
                samples_raw = await loop.run_in_executor(
                    None,
                    lambda n=num_samples: self._sdr.read_samples(n),
                )

                # Tomar os últimos _FFT_SIZE amostras complexas
                iq = np.asarray(samples_raw[-_FFT_SIZE:], dtype=np.complex64)

                # FFT com janela de Blackman; fftshift para colocar DC ao centro
                fft = np.fft.fftshift(np.fft.fft(iq * window, n=_FFT_SIZE))
                power_db = (20.0 * np.log10(np.abs(fft) / _FFT_SIZE + 1e-10)).astype(np.float32)

                min_db = float(np.percentile(power_db, 5))
                max_db = float(np.percentile(power_db, 99))
                bin_hz = self._sample_rate / _FFT_SIZE
                freq_start_hz = float(current_freq - self._sample_rate / 2)

                frame = SpectrumFrame(
                    values=power_db,
                    min_db=min_db,
                    max_db=max_db,
                    bin_hz=bin_hz,
                    freq_start_hz=freq_start_hz,
                )

                for q in list(self._queues):
                    if not q.full():
                        await q.put(frame)

                await asyncio.sleep(_FRAME_INTERVAL_S)

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Erro no RTLSDRSource._run — a parar fonte RTL-SDR")
        finally:
            await self._close_sdr()
