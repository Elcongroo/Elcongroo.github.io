import { createHash } from 'node:crypto';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { renderExtraDiagram } from './render-extra-diagram.mjs';

// Keep the renderer's CSS variables and selectors isolated from the page theme.
const rendererVariables = /--(?:bg|fg|line|accent|muted|surface|border|_text-sec|_text-muted|_text-faint|_text|_line|_arrow|_node-fill|_node-stroke|_group-fill|_group-hdr|_inner-stroke|_key-badge)\b/g;

export function renderProtocolDiagram(source, instance = 'inline') {
  const extra = renderExtraDiagram(source);
  let svg = extra || renderMermaidSVG(source, {
    bg: 'var(--paper)', fg: 'var(--ink)', surface: 'var(--paper)',
    accent: 'var(--diagram-edge)', line: 'var(--diagram-edge)',
    border: 'var(--diagram-border)', muted: 'var(--body)',
    font: 'Noto Serif SC Variable',
  });
  svg = svg.replace(/@import\s+url\([^)]*\);?\s*/g, '');
  if (!extra) {
    svg = svg.replace(rendererVariables, name => `--protocol-${name.slice(2)}`);
    // Inline SVG styles are otherwise document-wide, including text and other SVGs.
    svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${css
      .replace(/\btext\s*\{/g, '[data-protocol-diagram] text {')
      .replace(/\.mono\s*\{/g, '[data-protocol-diagram] .mono {')
      .replace(/\bsvg\s*\{/g, '[data-protocol-diagram] {')}</style>`);
  }
  const prefix = `protocol-${createHash('sha256').update(source).digest('hex').slice(0, 12)}-${instance}-`;
  for (const id of new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))) {
    svg = svg.replaceAll(`id="${id}"`, `id="${prefix}${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}${id})`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}${id}"`);
  }
  const width = Number(svg.match(/\bwidth="([\d.]+)"/)?.[1] || 700);
  // Merge sizing into the existing style: duplicate attributes discard theme variables.
  svg = svg.replace(/<svg\b([^>]*)>/, (_, attributes) => {
    const sizing = `width:${width}px;min-width:${Math.min(width, 1700)}px`;
    const styled = /\bstyle="/.test(attributes)
      ? attributes.replace(/\bstyle="([^"]*)"/, (_, style) => `style="${style};${sizing}"`)
      : `${attributes} style="${sizing}"`;
    return `<svg data-protocol-diagram aria-hidden="true" focusable="false"${styled}>`;
  });
  return svg;
}
