#!/usr/bin/env bash
# Ustawia hasło do https://glamcore.pl/admin (login: admin). Uruchamiaj w swoim terminalu:
#   bash www/deploy/haslo-admina.sh
#
# Hasło wpisujesz dwa razy w okienku `caddy hash-password` na serwerze. Na serwer trafia
# tylko jego skrót (bcrypt), samego hasła nie zapisuje nigdzie ani ten skrypt, ani Caddy.
set -euo pipefail

HOST="${GLAM_VPS:-root@185.193.112.243}"

ssh -t "$HOST" 'set -e
  echo "Nowe hasło do glamcore.pl/admin (login: admin). Wpisz je dwa razy:"
  SKROT=$(caddy hash-password)
  cp -p /etc/caddy/glam-admin.hasla /etc/caddy/glam-admin.hasla.prev
  printf "admin %s\n" "$SKROT" > /etc/caddy/glam-admin.hasla
  chown root:caddy /etc/caddy/glam-admin.hasla && chmod 640 /etc/caddy/glam-admin.hasla
  if runuser -u caddy -- caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && rm -f /etc/caddy/glam-admin.hasla.prev
    echo "Gotowe: hasło ustawione."
  else
    mv /etc/caddy/glam-admin.hasla.prev /etc/caddy/glam-admin.hasla
    echo "BŁĄD: nie udało się zapisać hasła, zostało poprzednie." >&2
    exit 1
  fi'
