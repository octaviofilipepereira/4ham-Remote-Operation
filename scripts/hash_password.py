#!/usr/bin/env python3
"""Gera um hash bcrypt para usar no remote_config.yaml.

Uso:
    python scripts/hash_password.py <password>
"""
import sys

import bcrypt


def main() -> None:
    if len(sys.argv) != 2:
        print("Uso: python scripts/hash_password.py <password>", file=sys.stderr)
        sys.exit(1)
    password = sys.argv[1].encode()
    hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12))
    print(hashed.decode())


if __name__ == "__main__":
    main()
