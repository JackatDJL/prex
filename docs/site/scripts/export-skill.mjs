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
