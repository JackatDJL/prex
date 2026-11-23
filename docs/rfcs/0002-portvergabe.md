# RFC 0002 — Lokale TCP-Portvergabe

Status: Entwurf · 23. November 2026

Prex verwaltet eine gemeinsame Vergabe für alle Projekte desselben OS-Benutzers auf einem Gerät und in derselben Netzwerk-Namespace. Andere Benutzer, Container und Programme werden über den Bind-Test berücksichtigt, soweit sie denselben Netzwerk-Stack und eine kollidierende Bind-Adresse verwenden. Eine benutzerübergreifende Reservierungsstelle wäre ein eigener Systemdienst.

## Konfiguration

```json
{
  "version": 1,
  "ports": {
    "min": 41000,
    "max": 41999
  }
}
```

Vorgeschlagener Pfad: `${XDG_CONFIG_HOME:-~/.config}/prex/config.json`. Ohne Datei gilt der Beispielbereich. Grenzen sind inklusive und müssen ganze Zahlen zwischen 1024 und 65535 sein. Eine ungültige Datei ergibt einen Diagnosefehler mit Pfad. Projekte können Rollen und Port-Übergabe vereinbaren. Die globale Range bleibt dabei maßgeblich. Der private Zustand liegt unter `${XDG_STATE_HOME:-~/.local/state}/prex` und wird über Worktrees hinweg geteilt.

## Vergabe und Lebensdauer

1. Für jeden Start wird die konfigurierte Range ohne Wiederholung in zufälliger Reihenfolge geprüft. MVP: TCP auf `127.0.0.1`. Unterstützte Profile müssen dieselbe Adresse verwenden. Hosts, die auf IPv6 oder mehreren Adressen lauschen, brauchen einen entsprechend angepassten Bind-Test.
2. Ein realer Socket-Bind prüft den Kandidaten. Solange der Probe-Socket offen ist, legt Prex im gemeinsamen Zustand atomar eine Reservierung pro Port an, etwa durch exklusives Erstellen einer Datei. Bereits belegte Reservierungen und `EADDRINUSE` führen zum nächsten Kandidaten. Andere Fehler liefern eine Diagnose. Ein Start mit mehreren Rollen startet erst nach vollständiger Reservierung und gibt bei Teilfehlern jede eigene Reservierung frei.
3. Direkt vor dem Start schließt Prex die Probe-Sockets. Die Reservierungen bleiben bis zum Ende der verwalteten Ausführung bestehen. Kooperierende Aufrufe überspringen diese Ports auch während der Übergabe. Ein fremder Prozess kann zwischen Schließen und Anwendungs-Bind weiterhin zuvorkommen. Der Start soll in diesem Fall mit einem sichtbaren Fehler enden, sofern das Profil einen festen Bind erzwingt. Ein generischer Wiederholungsversuch könnte einen Startbefehl mit Nebenwirkungen doppelt ausführen.
4. Die Einträge enthalten eine eindeutige Ausführungs-ID und die zur Wiedererkennung nötige Prozessidentität. Das Aufräumen verwaister Einträge braucht eine mit der Vergabe serialisierte Operation, die Besitzer erneut prüft und nur dessen Eintrag löscht. PID-Wiederverwendung und ein Absturz während der Eintragserstellung sind eigene Testfälle. Solange ein Eintrag keinem sicher beendeten Besitzer zugeordnet werden kann, bleibt er reserviert. Ein noch laufender Fremd- oder Kindprozess wird weiterhin durch den Bind-Test abgefangen.

Eine volle Range erzeugt einen Fehler mit Bereich und Anzahl angeforderter Ports. Port `0` wie im Portfolio-Skript wäre einfacher, überlässt den Bereich und die Auswahl aber dem Betriebssystem. Eine lückenlose Übergabe über einen vererbten Socket setzt Unterstützung im Zielserver voraus. Ein Proxy könnte den externen Port durchgehend halten, braucht aber weiterhin einen internen Port und muss HTTP beziehungsweise HMR-Wechselwirkungen abdecken. Für 0.1 ist die direkte Übergabe vorgeschlagen. [Node.js TCP listen](https://nodejs.org/api/net.html#serverlistenoptions-callback)

## Abnahme und offene Entscheidungen

- Zwei parallele Aufrufe in verschiedenen Repos bekommen verschiedene Ports. Separate Tests decken Fremdbelegung, erschöpfte Range und einen Start mit zwei Ports bei nur einem freien Platz ab.
- Nach regulärem Exit kann derselbe Port erneut vergeben werden. Tests simulieren Absturz, PID-Wiederverwendung und einen fremden Bind während der Übergabe.
- Zur Diskussion stehen Default-Range und ob „geräteweit“ auch mehrere OS-Benutzer koordinieren soll.
