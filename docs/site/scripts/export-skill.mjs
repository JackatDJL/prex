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

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const skill = await readFile(new URL('../../../skills/prex/SKILL.md', import.meta.url), 'utf8');
const description = skill.match(/^description: (.+)$/m)?.[1];
if (!description) throw new Error('Prex skill is missing its description');

const discovery = new URL('../public/.well-known/agent-skills/', import.meta.url);
await mkdir(new URL('prex/', discovery), { recursive: true });
await Promise.all([
  writeFile(new URL('prex/SKILL.md', discovery), skill),
  writeFile(new URL('index.json', discovery), JSON.stringify({
    skills: [{ name: 'prex', description, files: ['SKILL.md'] }],
  }, null, 2) + '\n'),
]);

const installer = await readFile(new URL('../../../distribution/install.sh', import.meta.url), 'utf8');
const repo = process.env.PREX_DOWNLOAD_REPOSITORY || 'JackatDJL/prex';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid PREX_DOWNLOAD_REPOSITORY');
await writeFile(new URL('../public/install', import.meta.url), installer.replace(
  "repo='JackatDJL/prex'", `repo='${repo}'`,
));
