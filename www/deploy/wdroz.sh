#!/usr/bin/env bash
# Wdrożenie strony GLAM (glamcore.pl) na VPS. Uruchamiaj z dowolnego miejsca:
#   bash www/deploy/wdroz.sh
#
# Co robi:
#  1. wgrywa same pliki strony do /srv/glam-www (bez deploy/, serwer/ i README.md),
#  2. wgrywa usługę zgłoszeń do /opt/glam/app i jej unit systemd,
#  3. przy pierwszym uruchomieniu zakłada konto `glam`, katalogi, klucz admina
#     i tymczasowe, nieznane nikomu hasło do /admin (ustawisz je haslo-admina.sh),
#  4. sprawdza całą konfigurację Caddy i dopiero wtedy ją przeładowuje.
# Jeśli walidacja się nie uda, przywraca poprzedni glam.caddy, a Caddy działa
# dalej na starej konfiguracji. Innych projektów na serwerze nie dotyka.
set -euo pipefail

HOST="${GLAM_VPS:-root@185.193.112.243}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

rsync -rlt --delete \
  --exclude 'deploy/' --exclude 'serwer/' --exclude 'README.md' --exclude '.*' \
  "$DIR/" "$HOST:/srv/glam-www/"

scp -q "$DIR/deploy/glam.caddy" "$HOST:/etc/caddy/glam.caddy.new"
scp -q "$DIR/serwer/zgloszenia.mjs" "$HOST:/tmp/glam-zgloszenia.mjs"
scp -q "$DIR/deploy/glam-zgloszenia.service" "$HOST:/etc/systemd/system/glam-zgloszenia.service"

ssh "$HOST" 'set -e
  chown -R root:root /srv/glam-www
  find /srv/glam-www -type d -exec chmod 755 {} +
  find /srv/glam-www -type f -exec chmod 644 {} +

  # Konto i katalogi usługi (tylko za pierwszym razem). Kod należy do roota,
  # więc nawet przejęta usługa nie podmieni samej siebie.
  id glam >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin glam
  install -d -m 750 -o root -g glam /opt/glam /opt/glam/app
  install -d -m 700 -o glam -g glam /opt/glam/dane
  install -m 644 -o root -g root /tmp/glam-zgloszenia.mjs /opt/glam/app/zgloszenia.mjs
  rm -f /tmp/glam-zgloszenia.mjs
  chmod 644 /etc/systemd/system/glam-zgloszenia.service

  # Wspólny klucz Caddy ↔ usługa (tylko za pierwszym razem).
  if [ ! -f /opt/glam/glam.env ]; then
    KLUCZ=$(openssl rand -hex 32)
    printf "GLAM_KLUCZ_ADMINA=%s\n" "$KLUCZ" > /opt/glam/glam.env
    printf "header_up X-Glam-Klucz \"%s\"\n" "$KLUCZ" > /etc/caddy/glam-klucz.caddy
  fi
  chown root:glam /opt/glam/glam.env && chmod 640 /opt/glam/glam.env
  chown root:caddy /etc/caddy/glam-klucz.caddy && chmod 640 /etc/caddy/glam-klucz.caddy

  # Hasło do /admin: dopóki nie ustawisz własnego, jest losowe i nikt go nie zna.
  if [ ! -s /etc/caddy/glam-admin.hasla ]; then
    printf "admin %s\n" "$(caddy hash-password --plaintext "$(openssl rand -hex 24)")" > /etc/caddy/glam-admin.hasla
  fi
  chown root:caddy /etc/caddy/glam-admin.hasla && chmod 640 /etc/caddy/glam-admin.hasla

  systemctl daemon-reload
  systemctl enable --quiet glam-zgloszenia
  systemctl restart glam-zgloszenia
  sleep 1
  systemctl is-active --quiet glam-zgloszenia || { journalctl -u glam-zgloszenia -n 20 --no-pager; echo "BŁĄD: usługa zgłoszeń nie wstała" >&2; exit 1; }

  [ -f /etc/caddy/glam.caddy ] && cp /etc/caddy/glam.caddy /etc/caddy/glam.caddy.prev
  mv /etc/caddy/glam.caddy.new /etc/caddy/glam.caddy
  chmod 644 /etc/caddy/glam.caddy
  # Walidacja jako `caddy`, nie root: validate otwiera pliki dzienników, a jako
  # root założyłby je z właścicielem root i działający Caddy nie mógłby w nie pisać.
  if runuser -u caddy -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/glam-validate.log 2>&1; then
    systemctl reload caddy
    echo "OK: strona i zgłoszenia wgrane, Caddy przeładowany"
  else
    cat /tmp/glam-validate.log
    # Pusty plik zamiast usuniętego: Caddyfile go importuje, a brak pliku
    # wywróciłby następne przeładowanie Caddy także innym projektom.
    if [ -f /etc/caddy/glam.caddy.prev ]; then mv /etc/caddy/glam.caddy.prev /etc/caddy/glam.caddy; else : > /etc/caddy/glam.caddy; fi
    echo "BŁĄD: konfiguracja nie przeszła walidacji, przywrócono poprzednią" >&2
    exit 1
  fi'
