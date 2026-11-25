/**
 * Prex
 *
 * @description Preview manager extended
 * @author Jack Ruder <jack@djl.foundation>
 * @copyright 2026 Jack Ruder
 * @see https://jack.djl.foundation
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Link from 'next/link';
import { InstallCommand } from './install-command';

const repo = 'https://github.com/JackatDJL/prex';
const install = 'curl -fsSL https://prex.djl.foundation/install | bash';

export function Home({ english = false }: { english?: boolean }) {
  const t = (de: string, en: string) => english ? en : de;
  const docs = english ? '/en/docs' : '/docs';
  const licensed = existsSync(resolve(process.cwd(), '../../LICENSE'));
  return <div className="landing" lang={english ? 'en' : 'de'}>
    <header className="masthead">
      <Link href={english ? '/en/' : '/'} className="wordmark"><img src="/icon.svg" width="30" height="30" alt="" />Prex</Link>
      <nav aria-label={t('Hauptnavigation', 'Main navigation')}>
        <Link href={docs}>{t('Dokumentation', 'Docs')}</Link>
        <Link href={english ? '/' : '/en/'} hrefLang={english ? 'de' : 'en'}>{english ? 'Deutsch' : 'English'}</Link>
        <a href={repo}>GitHub</a>
      </nav>
    </header>
    <main>
      <section className="hero">
        <h1>{t('Deine Dev-Server. Jeder auf seinem Port.', 'Your dev servers. Each on its own port.')}</h1>
        <p>{t('Starte mehrere Projekte und Git-Worktrees nebeneinander. Prex weist jedem Server einen freien Port zu und merkt sich, wo dein Preview läuft.', 'Run projects and Git worktrees side by side. Prex assigns a free port to each server and remembers where your preview is running.')}</p>
        <InstallCommand command={install} copy={t('Kopieren', 'Copy')} copied={t('Kopiert', 'Copied')} failed={t('Manuell kopieren', 'Copy manually')} />
        <div className="hero-links">
          <Link className="button" href={docs}>{t('Erste Schritte', 'Quickstart')}</Link>
          <a href="/install">{t('Installer ansehen', 'View installer')}</a>
          <a href={licensed ? repo + '/blob/main/LICENSE' : repo}>{licensed ? 'Steal my code legally' : t('Quellcode auf GitHub', 'Source on GitHub')}</a>
        </div>
      </section>
      <section className="port-section">
        <div className="section-wrap split">
          <div><h2>{t('Wenn Port 3000 schon belegt ist', 'When port 3000 is already taken')}</h2>
          <p>{t('Zwei Worktrees mit derselben Dev-Konfiguration wollen denselben Port. Prex reserviert freie Ports pro Start und reicht sie an deinen vorhandenen Befehl weiter.', 'Two worktrees with the same dev config ask for the same port. Prex reserves free ports for each launch and passes them to your existing command.')}</p>
          <Link href={docs + '/configuration'}>{t('Ports und Projekt-Scripts', 'Ports and project scripts')}</Link></div>
          <figure className="port-map">
            <figcaption>{t('Beispiel: zwei Worktrees', 'Example: two worktrees')}</figcaption>
            <div><code>main</code><span aria-hidden>────</span><code>127.0.0.1:41408</code></div>
            <div><code>feature/search</code><span aria-hidden>────</span><code>127.0.0.1:41701</code></div>
          </figure>
        </div>
      </section>
      <section className="section-wrap split feature">
        <div><h2>{t('Preview wiederfinden', 'Find your preview again')}</h2><p>{t('Vergib beim Start einen Namen. Mit list findest du URL und Logpfad, mit stop beendest du genau diese Session.', 'Give the preview a name at launch. Use list to find its URL and log, and stop to shut down that session.')}</p><Link href={docs + '/sessions'}>{t('Sessions, QR und Tailscale', 'Sessions, QR and Tailscale')}</Link></div>
        <pre className="terminal"><code>{'$ prex start --name web -- npm run dev\nweb (a84d2c1e0b367941)\nhttp://127.0.0.1:41408\n\n$ prex list\n$ prex stop web'}</code></pre>
      </section>
      <section className="section-wrap feature-grid">
        <article><h2>{t('App und Vite', 'App and Vite')}</h2><p>{t('Gib zusammengehörigen Diensten benannte Ports und starte sie in einer Session.', 'Give related services named ports and launch them in one session.')}</p><Link href={docs + '/portfolio'}>{t('Laravel-Beispiel', 'Laravel example')}</Link></article>
        <article><h2>{t('Auf dem Handy öffnen', 'Open it on your phone')}</h2><p>{t('Leite den Preview im eigenen Tailnet weiter und öffne die URL per QR-Code.', 'Forward the preview inside your tailnet and open its URL with a QR code.')}</p><Link href={docs + '/sessions'}>Tailscale</Link></article>
      </section>
    </main>
    <footer className="section-wrap masthead"><span>Previews Extended</span><Link href={docs}>{t('Dokumentation', 'Documentation')}</Link></footer>
  </div>;
}
