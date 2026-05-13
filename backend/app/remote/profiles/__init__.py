"""Registo de perfis de rádio disponíveis.

Adicionar um novo rádio:
  1. Criar ``backend/app/remote/profiles/<nome>.py`` com um dataclass e
     ``PROFILE = <Classe>()``.
  2. Registar a chave string → módulo no dicionário ``_REGISTRY`` abaixo.
"""

import importlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Mapeamento: valor de ``rig.profile`` no config → módulo Python relativo
_REGISTRY: dict[str, str] = {
    "ft991a": ".ft991a",
    "x6100":  ".x6100",
}


def load_profile(profile_name: str) -> Any:
    """Carrega e devolve o objecto PROFILE do perfil indicado.

    Devolve ``None`` se o perfil não for reconhecido ou falhar ao importar.
    """
    module_path = _REGISTRY.get(profile_name)
    if module_path is None:
        logger.warning(
            "Perfil '%s' desconhecido — perfis disponíveis: %s",
            profile_name,
            list(_REGISTRY),
        )
        return None
    try:
        module = importlib.import_module(module_path, package=__name__)
        return getattr(module, "PROFILE")
    except Exception as exc:
        logger.error("Erro ao carregar perfil '%s': %s", profile_name, exc)
        return None
