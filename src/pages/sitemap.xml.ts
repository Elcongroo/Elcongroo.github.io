import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { topics } from '../lib/site';
import { absoluteUrl } from '../lib/paths';
export const GET:APIRoute=async(context)=>{
  const posts=await getCollection('posts',({data})=>!data.draft);
  const labs=await getCollection('lab',({data})=>!data.draft);
  const pages=['','articles/','lab/','topics/','about/','subscribe/',...topics.map(t=>`topics/${t.id}/`)];
  const entries=[...pages.map(path=>({path,updated:undefined as Date|undefined})),...posts.map(p=>({path:`articles/${p.id}/`,updated:p.data.updated})),...labs.map(p=>({path:`lab/${p.id}/`,updated:p.data.updated}))];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(e=>`<url><loc>${absoluteUrl(e.path,context.site!)}</loc>${e.updated?`<lastmod>${e.updated.toISOString().slice(0,10)}</lastmod>`:''}</url>`).join('')}</urlset>`,{headers:{'Content-Type':'application/xml'}});
};
