import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const common = {
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  updated: z.coerce.date(),
  draft: z.boolean().default(false),
};
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    ...common,
    takeaway: z.string().optional(),
    basis: z.object({ label: z.string(), href: z.string(), boundary: z.string() }).optional(),
    category: z.enum(['vpn', 'linux', 'crypto', 'pqc', 'performance', 'engineering']),
    tags: z.array(z.string()),
    kind: z.string(),
    minutes: z.number().positive(),
    featured: z.boolean().default(false),
    series: z.string(),
    seriesOrder: z.number().int().nonnegative(),
    difficulty: z.enum(['入门', '进阶', '专题研究']),
    prerequisites: z.array(z.string()),
    environment: z.array(z.string()),
    software: z.array(z.string()),
    conclusion: z.enum(['verified', 'source', 'public', 'pending']),
    realVerified: z.boolean(),
    verificationActor: z.string(),
    repository: z.url().optional(),
    evidence: z.array(z.object({ label: z.string(), path: z.string() })).default([]),
    changes: z.array(z.object({ date: z.coerce.date(), note: z.string() })),
  }).refine(data => (data.conclusion === 'verified') === data.realVerified, {
    message: '实验验证状态必须与 realVerified 一致。',
  }).refine(data => !data.realVerified || data.evidence.length > 0, {
    message: '已验证文章必须提供原始证据。',
  }),
});
const lab = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/lab' }),
  schema: z.object({
    ...common,
    number: z.string(),
    purpose: z.string(),
    environment: z.array(z.string()),
    result: z.string(),
    openQuestions: z.array(z.string()),
    conclusion: z.enum(['verified', 'source', 'public', 'pending']),
    performedBy: z.string(),
    article: z.string().optional(),
    evidence: z.array(z.object({ label: z.string(), path: z.string() })),
  }),
});
export const collections = { posts, lab };
