# Pliki czcionek

Wrzuć pliki .woff2 dokładnie pod tymi nazwami, potem usuń flagę `pending` dla danego kroju w `packages/core/src/look.ts`.
Jeśli masz tylko .otf/.ttf – przekonwertuję je do .woff2.

| Krój | Role | Oczekiwane pliki |
|---|---|---|
| Alte Haas Grotesk | head, body, label | alte-haas/alte-haas-400.woff2<br>alte-haas/alte-haas-700.woff2 |
| Louis George Café | head, body | louis-george/louis-george-300.woff2<br>louis-george/louis-george-400.woff2<br>louis-george/louis-george-700.woff2 |
| Circular Std | head, body, label | circular/circular-400.woff2<br>circular/circular-500.woff2<br>circular/circular-700.woff2 |
| Jane Austen | display | jane-austen/jane-austen-400.woff2 |
| Relationship of Mélodrame | display | melodrame/melodrame-400.woff2 |
| Altesse Std | display | altesse/altesse-400.woff2 |
| Apercu Mono | label | apercu-mono/apercu-mono-400.woff2<br>apercu-mono/apercu-mono-500.woff2 |

Licencja musi obejmować **web** oraz **osadzenie w aplikacji mobilnej** (App Store, Google Play).
