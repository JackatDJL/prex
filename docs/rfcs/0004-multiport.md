# RFC 0004 — Zwei bis fünf Ports pro Start

Status: Entwurf · 23. November 2026

**Vorschlag:** Ein Start kann bis zu fünf TCP-Ports gemeinsam aus dem konfigurierten Bereich reservieren. Ein Port bleibt der Standard. Projekte können den Ports Rollen geben. Ein zusammenhängender Block ist eine ausdrückliche Option für Programme, die mit relativen Portnummern arbeiten. [RFC 0002](0002-portvergabe.md) definiert den gemeinsamen Bereich und die Lebensdauer einer Reservierung.

```sh
prex run --ports 2 -- composer dev
prex run --ports 4 --contiguous -- ./dev-stack
```

## Übergabe

`--ports N` akzeptiert ganze Zahlen von 1 bis 5. Ein Projektprofil kann stattdessen eine geordnete Liste von Rollen wie `app` und `vite` definieren. Die Reihenfolge bestimmt die Zuordnung. Beispiel mit zwei Ports:

| Variable | Beispiel |
| --- | --- |
| `PORT`, `PREX_PORT`, `PREX_PORT_1` | `41408` |
| `PREX_PORT_2` | `41701` |
| `PREX_PORT_APP`, `PREX_PORT_VITE` | `41408`, `41701` bei entsprechendem Profil |

Rollennamen müssen nach der Umwandlung in Großbuchstaben eindeutige Suffixe ergeben. Das Profil kann die Rollen zusätzlich auf Variablen wie `SERVER_PORT` und `HOMEPAGE_PREVIEW_VITE_PORT` abbilden. Für das Portfolio kommen Hot-Datei und Vite-Env-Verzeichnis aus dem Profil. [RFC 0003](0003-integrationen.md)

## Vergabe

Bei unabhängigen Ports prüft Prex zufällig sortierte Kandidaten. Mit `--contiguous` prüft es zufällig sortierte Startpunkte, deren kompletter Block in die Range passt. Es meldet entweder den vollständigen Satz oder einen Fehler. Während der Auswahl werden Probe-Sockets gehalten und Reservierungen für den Start gemeinsam festgeschrieben. Parallele Vergaben müssen dabei so serialisiert werden, dass sie sich weder teilweise blockieren noch überschneiden. Lässt sich ein Block nicht vollständig reservieren, wird er komplett freigegeben. Beim Übergang an die Anwendung bleibt die Bind-Lücke aus RFC 0002 bestehen. Alle vergebenen Ports bleiben bis zum Ende des verwalteten Starts reserviert.

## Abnahme

- Zwei parallele Starts mit je fünf Ports erhalten überschneidungsfreie Sätze.
- Bei zu wenigen freien Ports startet kein Kindprozess. Eine fragmentierte Range kann unabhängige Ports liefern und gleichzeitig für einen zusammenhängenden Block zu klein sein.
- Portreihenfolge und Rollen sind für den Kindprozess eindeutig. Ein Startfehler gibt den ganzen Satz frei.
- Der Portfolio-Test prüft zwei parallele Starts mit je einem Laravel- und einem Vite-Port sowie getrennten Hot-Dateien.

Offen zur Diskussion bleibt, ob zusammenhängende Blöcke bereits für 0.1 gebraucht werden. Der Portfolio-Fall funktioniert mit unabhängig gewählten Ports.
