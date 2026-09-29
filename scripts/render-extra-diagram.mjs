const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Render the small packet/timeline subset used by the original manuscripts as static SVG.
// Labels and bit coordinates are read verbatim from the preserved Mermaid source.
export function renderExtraDiagram(source){
 const wrap=(width,height,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="color:var(--ink);font-family:var(--sans)">${body}</svg>`;
 if(source.startsWith('packet-beta')){
  const fields=[...source.matchAll(/^\s*(\d+)-(\d+):\s*"([^"]+)"\s*$/gm)];
  if(!fields.length)throw new Error('Packet diagram has no supported fields');
  const rows=Math.ceil((Math.max(...fields.map(f=>+f[2]))+1)/32);let out='';
  for(let r=0;r<rows;r++)for(let n=0;n<32;n++)out+=`<text x="${35+n*28}" y="${25+r*90}" font-size="11" text-anchor="middle" fill="var(--muted)">${r*32+n}</text>`;
  for(const [,a,b,label] of fields){const start=+a,end=+b,row=Math.floor(start/32);if(Math.floor(end/32)!==row)throw new Error('Split packet fields across 32-bit rows');out+=`<rect x="${21+(start%32)*28}" y="${36+row*90}" width="${(end-start+1)*28}" height="45" fill="var(--paper)" stroke="var(--line-strong)"/><text x="${21+((start%32)+(end-start+1)/2)*28}" y="${64+row*90}" font-size="13" text-anchor="middle" fill="var(--ink)">${esc(label)}</text>`;}
  return wrap(940,rows*90+5,out);
 }
 if(source.startsWith('timeline')){
  const title=source.match(/^\s*title (.+)$/m)?.[1]||'';const groups=[];
  for(const line of source.split('\n').slice(1)){if(/^\s*title\b/.test(line)||!line.trim())continue;const m=line.match(/^\s*(.*?)\s*:\s*(.+)$/);if(!m)throw new Error('Unsupported timeline line');if(m[1])groups.push({label:m[1],items:[]});groups.at(-1)?.items.push(m[2]);}
  let y=65;let out=`<text x="25" y="28" font-size="17" fill="var(--ink)">${esc(title)}</text>`;
  for(const g of groups){const h=g.items.length*28+28;out+=`<line x1="120" y1="${y}" x2="120" y2="${y+h}" stroke="var(--line-strong)"/><circle cx="120" cy="${y}" r="4" fill="var(--accent)"/><text x="100" y="${y+5}" text-anchor="end" font-size="14" fill="var(--ink)">${esc(g.label)}</text>`;g.items.forEach((s,i)=>out+=`<text x="145" y="${y+5+i*28}" font-size="14" fill="var(--ink)">${esc(s)}</text>`);y+=h;}
  return wrap(680,y+5,out);
 }
 return null;
}
