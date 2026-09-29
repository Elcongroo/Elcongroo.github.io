import type { CollectionEntry } from 'astro:content';
import manuscriptHistory from '../data/manuscript-history.json';

const history: Record<string, { firstRecorded: string; commit: string }> = manuscriptHistory;

/** A Git record proves that a manuscript existed, not when writing began. */
export function publicationTimeline(post: CollectionEntry<'posts'>) {
  const imported = !!post.data.provenance;
  const revised = post.data.updated.valueOf() > post.data.date.valueOf();
  return {
    imported,
    firstRecorded: history[post.id]?.firstRecorded,
    label: imported ? '收录本站' : '发布于',
    latestLabel: revised ? '修订于' : imported ? '收录于' : '发布于',
    latest: revised ? post.data.updated : post.data.date,
    revised,
  };
}
