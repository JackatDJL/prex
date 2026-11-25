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

import type { MetadataRoute } from 'next';
import { source, englishSource } from '../lib/source';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = 'https://prex.djl.foundation';
  return [{ url: origin }, { url: origin + "/en/" }, ...[...source.getPages(), ...englishSource.getPages()].map(({ url }) => ({ url: new URL(url, origin).href }))];
}
