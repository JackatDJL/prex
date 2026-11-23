import type { MetadataRoute } from 'next';
import { source } from '../lib/source';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = 'https://prex.djl.foundation';
  return [{ url: origin }, ...source.getPages().map(({ url }) => ({ url: new URL(url, origin).href }))];
}
