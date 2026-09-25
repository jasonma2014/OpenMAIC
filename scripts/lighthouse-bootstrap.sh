#!/usr/bin/env bash
# One-time server setup. Run on the Lighthouse host as root:
#   sudo bash lighthouse-bootstrap.sh 'ssh-ed25519 AAAA... comment'
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo on the server." >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Pass at least one SSH public key." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker
usermod -aG docker ubuntu

install -d -m 755 /opt/mingke
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
touch /home/ubuntu/.ssh/authorized_keys
chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys

for key in "$@"; do
  grep -qxF "$key" /home/ubuntu/.ssh/authorized_keys || printf '%s\n' "$key" >> /home/ubuntu/.ssh/authorized_keys
done

if [ ! -f /opt/mingke/env ]; then
  install -m 600 -o ubuntu -g ubuntu /dev/null /opt/mingke/env
  echo "Created /opt/mingke/env. Put the server environment in that file before the first publish." >&2
fi

echo "Docker is installed and the given public keys can log in as ubuntu."
