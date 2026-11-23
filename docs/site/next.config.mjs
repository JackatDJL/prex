import { createMDX } from 'fumadocs-mdx/next';

export default createMDX()({
  output: 'export',
  trailingSlash: true,
  turbopack: { root: import.meta.dirname },
});
