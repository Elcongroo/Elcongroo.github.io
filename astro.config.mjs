import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import remarkBaseLinks from './scripts/remark-base-links.mjs';

const base = process.env.BASE_PATH || '/';
export default defineConfig({
  site: process.env.SITE_URL || 'https://elcongroo.github.io',
  base,
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx()],
  markdown: {
    processor: unified({ remarkPlugins: [remarkBaseLinks] }),
    shikiConfig: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
      defaultColor: false,
    },
  },
});
