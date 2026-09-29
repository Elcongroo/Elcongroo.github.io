import { parseMermaid } from 'beautiful-mermaid';

const tones = ['blue', 'green', 'violet', 'amber'];
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const encode = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function colorDiagram(svg, source) {
  const nodes = new Map();
  const groups = new Map();
  const actors = new Map();
  // Read real group membership; never guess a node's technical role from its name.
  if (/^\s*(?:flowchart|graph|stateDiagram)\b/.test(source)) {
    const graph = parseMermaid(source);
    let groupIndex = 0;
    function visit(group) {
      const tone = tones[groupIndex++ % tones.length];
      groups.set(encode(group.id), tone);
      group.nodeIds.forEach(id => nodes.set(encode(id), tone));
      group.children.forEach(visit);
    }
    graph.subgraphs.forEach(visit);
  }
  svg = svg.replace(/<g\b[^>]*class="(?:node|subgraph|actor|class-node|entity)"[^>]*>/g, tag => {
    const kind = attribute(tag, 'class');
    const id = attribute(tag, 'data-id');
    const shape = attribute(tag, 'data-shape');
    let tone = 'blue';
    if (kind === 'subgraph') tone = groups.get(id) || 'blue';
    else if (kind === 'actor') {
      if (!actors.has(id)) actors.set(id, tones[actors.size % tones.length]);
      tone = actors.get(id);
    } else if (shape === 'diamond') tone = 'amber';
    else if (shape === 'cylinder' || kind === 'entity' || kind === 'class-node') tone = 'violet';
    else tone = nodes.get(id) || 'blue';
    return tag.replace('>', ` data-diagram-tone="${tone}">`);
  });
  svg = svg.replace(/<(?:line|rect)\b[^>]*class="(?:lifeline|activation)"[^>]*>/g, tag => {
    const tone = actors.get(attribute(tag, 'data-actor')) || 'blue';
    return tag.replace('>', ` data-diagram-tone="${tone}">`);
  });
  // These two explicit original highlights retain their distinction in both themes.
  return svg.replaceAll('fill="#e8f1ff"', 'fill="var(--diagram-blue-fill)"')
    .replaceAll('fill="#fff2cc"', 'fill="var(--diagram-amber-fill)"');
}
