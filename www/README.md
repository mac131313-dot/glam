# GLAM – strona platformy

Statyczna strona sprzedażowa GLAM (SaaS dla studiów ruchu i wellness). Bez kroku budowania i bez zależności:
`index.html`, `styles.css`, `main.js`, `favicon.svg`. Czcionki ładują się z Google Fonts.

**Przed publikacją:** ustaw adres na zgłoszenia w `main.js` (`CONTACT_EMAIL`). Formularz otwiera program pocztowy z gotową wiadomością, więc nie potrzebuje serwera.

**Podgląd lokalny:** konfiguracja `www` w `.claude/launch.json` (http://localhost:4321).

**Na VPS:** skopiuj zawartość katalogu, np. do `/var/www/glam`, i podaj ją przez nginx:

```nginx
server {
  listen 80;
  server_name twojadomena.pl www.twojadomena.pl;
  root /var/www/glam;
  index index.html;
  location / { try_files $uri $uri/ =404; }
  location ~* \.(css|js|svg)$ { expires 7d; add_header Cache-Control "public"; }
}
```

HTTPS: `certbot --nginx -d twojadomena.pl -d www.twojadomena.pl`.
