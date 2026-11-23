import Link from 'next/link';

export default function Home() {
  return (
    <div className="landing">
      <header className="masthead">
        <Link href="/" className="wordmark">
          <img src="/icon.svg" width="30" height="30" alt="" /> Prex
        </Link>
        <nav aria-label="Hauptnavigation">
          <Link href="/docs">Dokumentation</Link>
          <a href="https://github.com/JackatDJL/prex">GitHub</a>
        </nav>
      </header>
      <main className="hero">
        <div>
          <p className="product-name">Previews Extended</p>
          <h1>Freie Ports für deine Dev-Server.</h1>
          <p className="intro">Starte mehrere Projekte parallel. Prex findet freie Ports und übergibt sie als Umgebungsvariablen oder CLI-Argumente an deine Server.</p>
          <Link href="/docs" className="button">Erste Schritte <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="terminal" aria-label="Beispiel mit zwei benannten Projekt-Scripts">
          <pre>{'$ prex signalling\nPrex-Ports: 41408\n\n$ prex web\nPrex-Ports: 41701'}</pre>
          <Link href="/docs/configuration">Projekt-Scripts konfigurieren <span aria-hidden="true">→</span></Link>
        </div>
      </main>
    </div>
  );
}
