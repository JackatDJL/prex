import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = 'https://prex.djl.foundation';
const pages = [
  { slug: 'index', path: '/docs/', title: 'Erste Schritte' },
  { slug: 'sessions', path: '/docs/sessions/', title: 'Sessions und Freigabe' },
  { slug: 'configuration', path: '/docs/configuration/', title: 'Konfiguration' },
  { slug: 'just', path: '/docs/just/', title: 'Just' },
  { slug: 'portfolio', path: '/docs/portfolio/', title: 'Portfolio mit Statamic' },
  { slug: 'agents', path: '/docs/agents/', title: 'Agent-Skill' },
];

const heading = '# Prex\n\n> Previews Extended assigns free local TCP ports to development commands, manages named background sessions, and can share them privately over Tailscale.\n';
const skill = base + '/.well-known/agent-skills/prex/SKILL.md';

export function llmsIndex() {
  return [
    heading,
    '## Documentation',
    ...pages.map(({ title, path }) => `- [${title}](${base}${path})`),
    '',
    '## Agent resources',
    `- [Full Markdown documentation](${base}/llms-full.txt)`,
    `- [Prex Agent Skill](${skill})`,
    '- [Source repository](https://github.com/JackatDJL/prex)',
    '',
  ].join('\n');
}

export async function llmsFull() {
  const docs = await Promise.all(pages.map(async ({ slug, title, path }) => {
    const mdx = await readFile(join(process.cwd(), 'content', 'docs', slug + '.mdx'), 'utf8');
    const body = mdx.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
      .replace(/\]\(\/(?!\/)/g, `](${base}/`);
    return `## ${title}\n\nSource: ${base}${path}\n\n${body}`;
  }));
  return [heading, ...docs, `## Agent Skill\n\n[Prex Agent Skill](${skill})`, ''].join('\n\n');
}

export function textFile(body: string) {
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
