#!/usr/bin/env bash
# Gera um par de certificados TLS auto-assinados para desenvolvimento.
# Para produção usar Let's Encrypt (certbot).
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../certs" && pwd)"
mkdir -p "$CERTS_DIR"

openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout "$CERTS_DIR/key.pem" \
  -out    "$CERTS_DIR/cert.pem" \
  -subj   "/CN=4ham-remote/O=CT7BFV/C=PT" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Certificados gerados em $CERTS_DIR/"
echo "  cert.pem — certificado público"
echo "  key.pem  — chave privada (não commitar!)"
