#!/usr/bin/env bash
# Wdrożenie strony GLAM (glamcore.pl) na VPS. Uruchamiaj z dowolnego miejsca:
#   bash www/deploy/wdroz.sh
#
# Co robi:
#  1. wgrywa same pliki strony do /srv/glam-www (bez deploy/ i README.md),
#  2. wgrywa konfigurację do /etc/caddy/glam.caddy,
#  3. sprawdza całą konfigurację Caddy i dopiero wtedy ją przeładowuje.
# Jeśli walidacja się nie uda, przywraca poprzedni glam.caddy, a Caddy działa
# dalej na starej konfiguracji. Innych projektów na serwerze nie dotyka.
set -euo pipefail

HOST="${GLAM_VPS:-root@185.193.112.243}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

rsync -rlt --delete \
  --exclude 'deploy/' --exclude 'README.md' --exclude '.*' \
  "$DIR/" "$HOST:/srv/glam-www/"

scp -q "$DIR/deploy/glam.caddy" "$HOST:/etc/caddy/glam.caddy.new"

ssh "$HOST" 'set -e
  chown -R root:root /srv/glam-www
  find /srv/glam-www -type d -exec chmod 755 {} +
  find /srv/glam-www -type f -exec chmod 644 {} +
  [ -f /etc/caddy/glam.caddy ] && cp /etc/caddy/glam.caddy /etc/caddy/glam.caddy.prev
  mv /etc/caddy/glam.caddy.new /etc/caddy/glam.caddy
  chmod 644 /etc/caddy/glam.caddy
  # Walidacja jako `caddy`, nie root: validate otwiera pliki dzienników, a jako
  # root założyłby je z właścicielem root i działający Caddy nie mógłby w nie pisać.
  if runuser -u caddy -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/glam-validate.log 2>&1; then
    systemctl reload caddy
    echo "OK: strona wgrana, Caddy przeładowany"
  else
    cat /tmp/glam-validate.log
    # Pusty plik zamiast usuniętego: Caddyfile go importuje, a brak pliku
    # wywróciłby następne przeładowanie Caddy także innym projektom.
    if [ -f /etc/caddy/glam.caddy.prev ]; then mv /etc/caddy/glam.caddy.prev /etc/caddy/glam.caddy; else : > /etc/caddy/glam.caddy; fi
    echo "BŁĄD: konfiguracja nie przeszła walidacji, przywrócono poprzednią" >&2
    exit 1
  fi'
