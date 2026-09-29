import sources from '../src/data/publication-sources.json' with { type: 'json' };
import { renderProtocolDiagram } from './render-protocol-diagram.mjs';
const publications = new Map(sources.map(s => [s.document, `/articles/${s.slug}/`]));
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** Render original Mermaid and resolve document-library links without rewriting prose. */
export default function remarkReviewedNotes() {
  return function transform(tree) {
    let heading = '原文图示';
    let diagram = 0;
    function walk(node, parent, index) {
      if(node.type === 'heading') heading = node.children.map(n=>n.value || '').join('');
      if(node.type === 'code' && node.lang === 'mermaid') {
        const caption = `图 ${++diagram} · ${heading}`;
        const svg = renderProtocolDiagram(node.value, diagram);
        parent.children[index]={type:'html',value:`<figure class="protocol-figure"><div class="diagram-viewport" role="img" aria-label="${escape(caption)}" tabindex="0">${svg}</div><figcaption>${escape(caption)} · 宽图可横向滚动</figcaption><details class="diagram-source" data-pagefind-ignore><summary>查看原文图示源文本</summary><pre><code>${escape(node.value)}</code></pre></details></figure>`};
        return;
      }
      if(node.type === 'link' && !/^(?:https?:|#|\/)/.test(node.url)) {
        const name=decodeURIComponent(node.url).split('#')[0];
        if(name.endsWith('.md')) {
          if(publications.has(name))node.url=publications.get(name);
          else {
            // The referenced manuscript is not published. Keep its title, without a broken link.
            parent.children[index]={type:'text',value:node.children.map(n=>n.value || '').join('')+'（未选刊）'};
            return;
          }
        }
      }
      node.children?.forEach((child,i)=>walk(child,node,i));
    }
    walk(tree,null,0);
  };
}
