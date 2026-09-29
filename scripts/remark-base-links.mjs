/** Rewrite Markdown links only; MDX component links use pathFor explicitly. */
export default function remarkBaseLinks() {
  const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
  return function transform(tree) {
    function walk(node) {
      if (['link', 'image', 'definition'].includes(node.type) && node.url?.startsWith('/') && !node.url.startsWith('//')) {
        if (base && !node.url.startsWith(`${base}/`)) node.url = base + node.url;
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}
