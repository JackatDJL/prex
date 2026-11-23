# Deploy the docs to Vercel

Import `JackatDJL/prex` in Vercel, select `main` as the production branch, and set **Root Directory** to `docs/site`. Enable **Include source files outside of the Root Directory** so the build can copy the canonical skill from the repository root. The project config selects Next.js, installs dependencies with `npm ci`, builds with `npm run build`, and publishes the `out` directory. Select Node.js 24 or a supported 22.x version at least 22.22.

Under **Settings → Domains**, add `prex.djl.foundation`. Use the DNS record Vercel shows for this project at your DNS provider. Once Vercel verifies the domain, check `/`, `/docs/`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, and `/.well-known/agent-skills/index.json`. Run `npx skills add https://prex.djl.foundation --list` to verify public skill discovery.

The LLM endpoints are generated as static text during the docs build. When you add a docs page, include it in `docs/site/lib/llms.ts` so both text endpoints include it.

See [Vercel custom domain setup](https://vercel.com/docs/domains/set-up-custom-domain).
