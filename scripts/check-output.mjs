import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root = path.resolve('dist');
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const errors = [];
const files = [];
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).forEach(e => e.isDirectory() ? walk(path.join(dir,e.name)) : files.push(path.join(dir,e.name)));
walk(root);
const html = new Map(files.filter(f=>f.endsWith('.html')).map(f=>[f,fs.readFileSync(f,'utf8')]));
const ids = new Map([...html].map(([f,s])=>[f,new Set([...s.matchAll(/\bid="([^"]*)"/g)].map(m=>m[1]))]));
let refs=0;
for (const [file,content] of html) {
  if(content.includes('__VITE_PRELOAD__'))errors.push(`${file}: unresolved script preload marker`);
  const isRedirect=content.includes('http-equiv="refresh"');
  const headings=[...content.matchAll(/<h1[\s>]/g)];
  if(!isRedirect&&headings.length!==1)errors.push(`${path.relative(root,file)}: expected one h1`);
  if(!isRedirect&&!content.includes('name="description"'))errors.push(`${file}: missing description`);
  for(const m of content.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const ref=m[1].replaceAll('&amp;','&');
    if(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref))continue;
    const [url,fragment]=ref.split('#');
    if(url.startsWith('/')&&base&&!url.startsWith(`${base}/`)) {errors.push(`${file}: outside base ${ref}`);continue;}
    let target=url.startsWith('/') ? path.join(root,decodeURIComponent(url.slice(base.length)).split('?')[0]) : url ? path.resolve(path.dirname(file),decodeURIComponent(url.split('?')[0])) : file;
    if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
    if(!fs.existsSync(target))errors.push(`${path.relative(root,file)}: missing ${ref}`);
    else if(fragment&&ids.has(target)&&!ids.get(target).has(decodeURIComponent(fragment)))errors.push(`${file}: missing anchor ${ref}`);
    refs++;
  }
}
for(const file of files.filter(f=>f.endsWith('.css')&&!f.includes('/pagefind/'))) {
  for(const m of fs.readFileSync(file,'utf8').matchAll(/url\(["']?([^\s)'";]+)["']?\)/g)) {
    const value=m[1];
    if(/^(data:|https?:|#)/.test(value))continue;
    const target=value.startsWith('/')?path.join(root,value.slice(base.length)):path.resolve(path.dirname(file),value);
    if(!fs.existsSync(target))errors.push(`${file}: missing CSS asset ${value}`);
  }
}
for(const name of ['rss.xml','sitemap.xml','robots.txt','pagefind/pagefind.js']) {
  if(!fs.existsSync(path.join(root,name)))errors.push(`missing ${name}`);
}
const rss=fs.readFileSync(path.join(root,'rss.xml'),'utf8');
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const indexed=[...html.values()].filter(s=>s.includes('data-pagefind-body')).length;
// Astro may log a content render error yet finish the build. Never publish a silently missing article.
for(const file of fs.readdirSync('src/content/posts').filter(f=>/\.mdx?$/.test(f))){
  const source=fs.readFileSync(path.join('src/content/posts',file),'utf8');
  const frontmatter=source.split('\n---\n')[0];
  if(/^draft:\s*true\s*$/m.test(frontmatter))continue;
  const slug=file.replace(/\.mdx?$/,'');
  if(!html.has(path.join(root,`articles/${slug}/index.html`)))errors.push(`${slug}: source article missing from build`);
  if(/^editorial:\s*["']?research["']?\s*$/m.test(frontmatter)&&!html.get(path.join(root,`articles/${slug}/index.html`))?.includes('待 congroo 审阅'))errors.push(`${slug}: research review label missing`);
}
const rssCount=[...rss.matchAll(/<item>/g)].length;
if(rssCount!==indexed)errors.push(`RSS items ${rssCount} differ from indexable content ${indexed}`);
const redirects=[...html.values()].filter(s=>s.includes('http-equiv="refresh"')).length;
if([...sitemap.matchAll(/<url>/g)].length!==html.size-1-redirects)errors.push('Sitemap does not cover all normal HTML pages');
for (const [file, content] of html) {
  if(content.includes('class="diagram-viewport"')&&!content.includes('<svg'))errors.push(`${file}: build-time protocol SVG missing`);
  // Browsers silently drop duplicate attributes; this once erased every diagram's palette.
  for (const match of content.matchAll(/<svg\b[^>]*data-protocol-diagram[^>]*>[\s\S]*?<\/svg>/g)) {
    const svg = match[0];
    const tag = svg.slice(0, svg.indexOf('>') + 1);
    if ([...tag.matchAll(/\bstyle="/g)].length !== 1) errors.push(`${file}: diagram needs exactly one root style`);
    if (/--([\w-]+)\s*:\s*var\(--\1\)/.test(svg)) errors.push(`${file}: self-referencing diagram color`);
    if (/<style>[\s\S]*?(?:^|[}\n])\s*(?:svg|text|\.mono)\s*\{/m.test(svg)) errors.push(`${file}: unscoped diagram style`);
    if (svg.includes('--protocol-bg:') && !svg.includes('--protocol-bg:var(--paper)')) errors.push(`${file}: diagram background lost theme binding`);
  }
}
// Imported prose must remain consistent with the selected manuscript snapshot.
const sources=JSON.parse(fs.readFileSync('src/data/publication-sources.json','utf8'));
let originalDiagrams=0;
for(const source of sources){
  const markdown=fs.readFileSync(`src/content/posts/${source.slug}.md`,'utf8');
  const body=markdown.slice(markdown.indexOf('\n---\n')+5).trim()+'\n';
  if(createHash('sha256').update(body).digest('hex')!==source.bodySha256)errors.push(`${source.slug}: selected manuscript body changed`);
  const diagrams=[...body.matchAll(/^```mermaid/gm)].length;
  const output=fs.readFileSync(path.join(root,`articles/${source.slug}/index.html`),'utf8');
  if([...output.matchAll(/class="diagram-viewport"/g)].length!==diagrams)errors.push(`${source.slug}: original diagram count differs`);
  if(output.includes('fonts.googleapis.com'))errors.push(`${source.slug}: diagram adds an external font request`);
  originalDiagrams+=diagrams;
}
console.log(JSON.stringify({originalManuscripts:sources.length,originalDiagrams,base:base||'/',htmlPages:html.size,localReferences:refs,rssItems:rssCount,indexedDocuments:indexed,errors},null,2));
if(errors.length)process.exitCode=1;
