import { textFile } from '../../lib/llms';

export const dynamic = 'force-static';
export const GET = () => textFile('User-agent: *\nAllow: /\nSitemap: https://prex.djl.foundation/sitemap.xml\n');
