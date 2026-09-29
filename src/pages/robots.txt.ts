import type { APIRoute } from 'astro';
import {site} from '../lib/site';
import {absoluteUrl,pathFor} from '../lib/paths';
export const GET:APIRoute=(context)=>new Response(`User-agent: *\n${site.isPublic?`Allow: ${pathFor()}`:'Disallow: /'}\nSitemap: ${absoluteUrl('sitemap.xml',context.site!)}\n`,{headers:{'Content-Type':'text/plain'}});
