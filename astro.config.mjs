import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import remarkReviewedNotes from './scripts/remark-reviewed-notes.mjs';
import remarkBaseLinks from './scripts/remark-base-links.mjs';

const base = process.env.BASE_PATH || '/';
export default defineConfig({
  site: process.env.SITE_URL || 'https://elcongroo.github.io',
  base,
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx()],
  redirects: {
    '/articles/reading-a-security-gateway/': '/journey/',
    '/articles/vpn-connected-is-not-enough/': '/articles/strongswan-child-sa-xfrm/',
    '/articles/kem-is-not-a-vpn/': '/journey/#crypto',
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkReviewedNotes, remarkBaseLinks] }),
    shikiConfig: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
      defaultColor: false,
    },
  },
});
