import fs from 'node:fs';
import path from 'node:path';

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
  const headings=[...content.matchAll(/<h1[\s>]/g)];
  if(headings.length!==1)errors.push(`${path.relative(root,file)}: expected one h1`);
  if(!content.includes('name="description"'))errors.push(`${file}: missing description`);
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
const rssCount=[...rss.matchAll(/<item>/g)].length;
if(rssCount!==indexed)errors.push(`RSS items ${rssCount} differ from indexable content ${indexed}`);
if([...sitemap.matchAll(/<url>/g)].length!==html.size-1)errors.push('Sitemap does not cover all normal HTML pages');
for (const [file, content] of html) {
  if(content.includes('class="diagram-viewport"')&&!content.includes('<svg'))errors.push(`${file}: build-time protocol SVG missing`);
}
console.log(JSON.stringify({base:base||'/',htmlPages:html.size,localReferences:refs,rssItems:rssCount,indexedDocuments:indexed,errors},null,2));
if(errors.length)process.exitCode=1;
