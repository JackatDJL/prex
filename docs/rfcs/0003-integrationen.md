# RFC 0003 — Framework-Integration und benannte Previews

Status: Entwurf · 23. November 2026

## Vertrag für den Startbefehl

Prex setzt für einen einfachen Start `PREX_PORT`, `PORT` und `PREX_HOST=127.0.0.1` im Kindprozess. Es lässt den Startbefehl und seine Argumente unverändert. Ein Projekt kann einen Port über diese Variablen übernehmen. Für mehrere Ports schlägt dieses RFC benannte Rollen und eine explizite Zuordnung zu Umgebungsvariablen vor. Ein optionales Projektprofil darf auch den Startbefehl definieren, etwa für `prex run --profile preview`. Damit bleiben Java, PHP und andere Stacks genauso anschließbar wie JavaScript.

| Einstieg | Erwartung |
| --- | --- |
| `prex bun run dev` mit Next.js | `next dev` liest `PORT` aus der Prozessumgebung. Ein festes `--port` im Script muss angepasst werden. Für einen Loopback-Start zusätzlich `--hostname 127.0.0.1` setzen. [Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next) |
| `prex bun run dev` mit Vite | Projektkonfiguration liest `PREX_PORT` und `PREX_HOST` und aktiviert `strictPort`. Alternativ erhält der direkte Vite-Aufruf Werte per Flags. So bleibt die URL bei einem Bind-Konflikt verlässlich. [Vite CLI](https://vite.dev/guide/cli.html) |
| Laravel `artisan serve` | Das Profil bindet `SERVER_PORT` und `SERVER_HOST` an dieselbe Port-Rolle und Adresse. Laravel 13 liest beide als Defaults. Auch direkte `--port`- und `--host`-Argumente sind möglich. [Laravel ServeCommand](https://github.com/laravel/framework/blob/13.x/src/Illuminate/Foundation/Console/ServeCommand.php) |
| `prex composer dev` | Das Composer-Script und die dahinterliegenden Prozesse müssen die Variablen verwenden. Composer kann Argumente an Scripts weiterreichen. Welche Bedeutung ein Flag hat, hängt vom Script ab. [Composer Scripts](https://getcomposer.org/doc/articles/scripts.md) |

Ein hartcodierter Port innerhalb eines Scripts oder Programms braucht eine Änderung im Projekt oder einen alternativen Startbefehl im Profil. Prex erkennt aus `bun run dev` allein weder das Framework noch dessen Bind-Adresse. Eine Vorschau-URL als funktionsfähig zu melden erfordert einen expliziten Readiness-Check. Automatische Adapter sollten erst aus den erprobten Integrationen entstehen.

## Referenzfall Portfolio

Gelesen im Portfolio-Checkout bei `51b27c2`: `.agents/skills/homepage-preview/SKILL.md`, `docs/local-dev-previews.md`, `scripts/dev-preview.mjs`, `scripts/dev-preview-runner.mjs`, `composer.json`, `package.json`, `vite.config.js` und `app/Providers/AppServiceProvider.php`.

Der Preview-Manager startet Vite und Laravel separat auf IPv4-Loopback, mit zwei per Betriebssystem gewählten Ports. Er wartet erst auf Vite unter `/@vite/client`, dann auf Laravel. Ein eigenes Hot-File verbindet die beiden Prozesse. Vite startet mit leerem Env-Verzeichnis und deaktiviertem Bun-Env-Loading. Laravel liest die Projektumgebung wie bisher. Der Manager hat benannte Starts pro Worktree mit Git-Provenienz, Health-Abfragen, redigierten Logs und Linux-spezifischer Prozessgruppenprüfung. Laufende Previews im selben Worktree können dieselben Anwendungsdaten verwenden.

Im aktuellen Checkout ruft `composer dev` zunächst `php artisan dev` auf. Der eigentliche Preview-Manager nutzt `php artisan serve` und Vite direkt. Der Vorschlag für Prex ist daher ein Portfolio-Profil mit den Rollen `app` und `vite`. Vite erhält `HOMEPAGE_PREVIEW_VITE_PORT` und `HOMEPAGE_PREVIEW_HOST`. Beide Prozesse erhalten dasselbe pro Lauf erzeugte `HOMEPAGE_PREVIEW_HOT_FILE`. Das Profil behält den isolierten Vite-Env-Pfad und die getrennten Readiness-Checks bei. Den Composer-Kurzbefehl im Portfolio erst als unterstützt dokumentieren, wenn dessen Startkette dieselben Einstellungen übernimmt.

## Lieferreihenfolge und offene Entscheidungen

1. **0.1:** Vordergrund-Wrapper und gemeinsame Portvergabe. Abnahme mit zwei gleichzeitig gestarteten Next-Projekten und einem Composer-Script, das einen konfigurierten Laravel-Port übernimmt.
2. **Erste Mehrport-Integration:** Portfolio-Profil mit zwei Ports und pro Lauf getrennten temporären Dateien. Abnahme mit zwei gleichzeitigen Starts, passendem Vite-Client je Laravel-Seite und sauberer Freigabe bei Teilfehler.
3. **Separat zur Diskussion:** Benannte Hintergrund-Previews mit `up`, `status`, `logs` und `down`. Dafür braucht es eine plattformgerechte Prozessidentität, private Logs und eine Entscheidung zur Übernahme der Git-Provenienz. Der Portfolio-Skill liefert dafür den Referenzablauf.

Für 0.1 ist besonders zu entscheiden, ob Profile und Mehrport-Starts bereits zur ersten öffentlichen Version gehören sollen. Das würde Statamic im Portfolio von Anfang an abdecken.
