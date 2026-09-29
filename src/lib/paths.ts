/** One base-aware helper for both username.github.io and /repository/ deployments. */
export function pathFor(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
export function absoluteUrl(path: string, site: URL): string {
  return new URL(pathFor(path), site).href;
}
