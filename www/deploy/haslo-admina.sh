#!/usr/bin/env bash
# Ustawia hasło do https://glamcore.pl/admin. Uruchamiaj w swoim terminalu:
#   bash www/deploy/haslo-admina.sh
#
# Hasło wpisujesz dwa razy na serwerze (nic nie widać przy pisaniu). Na serwer trafia
# tylko jego skrót (scrypt) w /opt/glam/admin.haslo, samego hasła nie zapisuje nigdzie
# ani ten skrypt, ani usługa. Zmiana działa od razu, bez restartu; zalogowane już
# urządzenia zostają zalogowane do restartu usługi.
set -euo pipefail

HOST="${GLAM_VPS:-root@185.193.112.243}"

ssh -t "$HOST" 'set -e
  read -rsp "Nowe hasło do glamcore.pl/admin (min. 10 znaków): " H1; echo
  read -rsp "Powtórz hasło: " H2; echo
  [ "$H1" = "$H2" ] || { echo "BŁĄD: hasła się różnią, nic nie zmieniono." >&2; exit 1; }
  SKROT=$(printf "%s" "$H1" | node /opt/glam/app/zgloszenia.mjs skrot-hasla)
  unset H1 H2
  printf "%s\n" "$SKROT" > /opt/glam/admin.haslo.new
  chown root:glam /opt/glam/admin.haslo.new && chmod 640 /opt/glam/admin.haslo.new
  mv /opt/glam/admin.haslo.new /opt/glam/admin.haslo
  echo "Gotowe: hasło ustawione."'
