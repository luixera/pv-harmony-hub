#!/bin/bash
# Autoriza a chave de deploy do pv-harmony-hub neste servidor.
# Uso: curl -sL https://raw.githubusercontent.com/luixera/pv-harmony-hub/main/s.sh | bash
set -e
mkdir -p ~/.ssh
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL9koLAqER5meK8bIrPr5rWmteGhsgMpTeUM3o/gHttb deploy-pv-harmony-hub'
grep -qF "$KEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$KEY" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
echo "OK: chave de deploy autorizada para $(whoami)@$(hostname -I 2>/dev/null | awk '{print $1}')"
