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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { englishSource, source } from './source';

const base = 'https://prex.djl.foundation';
const pages = [
  ...source.getPages().map(page => ({ page, language: 'docs' })),
  ...englishSource.getPages().map(page => ({ page, language: 'en' })),
].map(({ page, language }) => ({
  slug: page.slugs.join('/') || 'index',
  path: page.url,
  title: page.data.title,
  language,
}));

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
  const docs = await Promise.all(pages.map(async ({ slug, title, path, language }) => {
    const mdx = await readFile(join(process.cwd(), 'content', language, slug + '.mdx'), 'utf8');
    const body = mdx.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
      .replace(/\]\(\/(?!\/)/g, `](${base}/`);
    return `## ${title}\n\nSource: ${base}${path}\n\n${body}`;
  }));
  return [heading, ...docs, `## Agent Skill\n\n[Prex Agent Skill](${skill})`, ''].join('\n\n');
}

export function textFile(body: string) {
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
