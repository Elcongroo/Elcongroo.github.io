import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../lib/site';
import { absoluteUrl } from '../lib/paths';
const xml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export const GET:APIRoute=async(context)=>{
  const posts=await getCollection('posts',({data})=>!data.draft);
  const labs=await getCollection('lab',({data})=>!data.draft);
  const entries=[...posts.map(p=>({data:p.data,path:`articles/${p.id}/`})),...labs.map(p=>({data:p.data,path:`lab/${p.id}/`}))].sort((a,b)=>b.data.date.valueOf()-a.data.date.valueOf());
  const content=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(site.title)}</title><link>${xml(absoluteUrl('',context.site!))}</link><description>${xml(site.description)}</description><language>zh-CN</language><atom:link href="${xml(absoluteUrl('rss.xml',context.site!))}" rel="self" type="application/rss+xml"/>${entries.map(p=>{const url=absoluteUrl(p.path,context.site!);return `<item><title>${xml(p.data.title)}</title><description>${xml(('provenance' in p.data && p.data.provenance ? '原稿收录（RSS 日期为收录本站时间）。' : '') + p.data.description)}</description><link>${xml(url)}</link><guid isPermaLink="true">${xml(url)}</guid><pubDate>${p.data.date.toUTCString()}</pubDate></item>`;}).join('')}</channel></rss>`;
  return new Response(content,{headers:{'Content-Type':'application/rss+xml; charset=utf-8'}});
};
