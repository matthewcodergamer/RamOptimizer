#!/usr/bin/env bash
set -euo pipefail
openssl genrsa -out private-license-key.pem 2048
openssl rsa -in private-license-key.pem -pubout -out public-license-key.pem
chmod 600 private-license-key.pem
printf '%s\n' 'Keep private-license-key.pem outside Git and copy public-license-key.pem into premium.js.'
