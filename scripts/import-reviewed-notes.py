"""Publish an explicitly reviewed, locally supplied source catalog.

Usage: python3 scripts/import-reviewed-notes.py DOCS --catalog PRIVATE_CATALOG [--check]
The catalog and its privacy rules remain outside the public repository. The importer
never discovers or publishes files on its own; the public manifest records hashes.
"""
from pathlib import Path
import argparse, re, json, hashlib, subprocess, math
p=argparse.ArgumentParser();p.add_argument('docs');p.add_argument('--catalog',required=True);p.add_argument('--check',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[1];source=Path(args.docs).resolve();config=json.loads(Path(args.catalog).read_text());manifest=[]
def section_cut(body,n):
 return re.sub(r'^## '+str(n)+r'\.(?: |[^\d]).*?(?=^## \d+\.|^## 参考|\Z)','',body,flags=re.M|re.S)
def safe_text(s):
 for a,b in config['replacements'].items():s=s.replace(a,b)
 return s
for entry in config['entries']:
 slug=entry['slug'];name=entry['document'];raw=(source/name).read_text();title=safe_text(raw.splitlines()[0].removeprefix('# '));body=raw.split('\n',1)[1];omissions=[]
 body=re.sub(r'<!-- reading-stats:start -->.*?<!-- reading-stats:end -->\n?', '',body,flags=re.S)
 body=re.sub(r'^\| \*\*项目\*\* \| \*\*内容\*\* \|\n(?:\|.*\n)+','',body,flags=re.M)
 for n in config.get('cuts',{}).get(slug,[]):
  body=section_cut(body,n);omissions.append(f'第 {n} 节内部背景或非技术规划')
 # Remove one contextual preface that asserts a company-specific target architecture.
 if slug=='gateway-module-boundaries':
  body=re.sub(r'^> 本文是一份.*\n','> 本文选取通用职责划分与候选接口设计，不描述任何已采用的产品架构。\n',body,flags=re.M)
 if slug=='gateway-evolution-map':
  body=re.sub(r'^> 本文设计的是.*\n','> 本文保留技术路线的判断框架；具体实现仍需源码、构建和实测验证。\n',body,flags=re.M)
 cleaned=safe_text(body)
 if cleaned!=body:omissions.append('机构称谓与个人本机路径已泛化；技术推导保留')
 body=cleaned
 body=re.sub(r'^!!! \w+ "([^"]+)"\n((?:    .*\n|\n)+)',lambda m:'> **'+m[1]+'**\n'+''.join('> '+line[4:]+'\n' if line.startswith('    ') else '>\n' for line in m[2].splitlines())+'\n',body,flags=re.M)
 # Source appendices use H1 chapters. Shift only actual headings, not code examples.
 in_fence=False;has_h1=False
 for line in body.splitlines():
  if line.startswith('```'):in_fence=not in_fence
  elif not in_fence and line.startswith('# '):has_h1=True
 if has_h1:
  lines=[];in_fence=False
  for line in body.splitlines():
   if line.startswith('```'):in_fence=not in_fence
   elif not in_fence and re.match(r'^#{1,5} ',line):line='#'+line
   lines.append(line)
  body='\n'.join(lines)
 # Links to companions point to the published bundle; private experiment assets are not copied.
 body=body.replace('(downloads/源码接管验收矩阵.csv)','(/downloads/acceptance-matrix.csv)')
 companion=any(s in body for s in ['examples/network-programming','examples/linux-kernel-network-path'])
 if companion:body='> **配套材料**：本文引用的网络编程示例与只读快照脚本见[源码与使用说明](/downloads/network-examples.zip)。解压后保留 `examples/` 目录结构；脚本未在本次发布中重新实测。\n\n'+body
 historical=slug in ['ikev2-reference-lab','ikev2-single-vm-lab','pqc-ike-reference','vpn-benchmark-method']
 if historical:body='> **原稿实验记录**：以下保留原稿中的实验方法、观察与结果。本页未提供完整原始证据包，脚本路径是原实验资产的定位信息，不是本站下载地址。本次整理没有重跑实验，也不把这些记录标为已公开复核的实测结果。\n\n'+body
 body=body.strip()+'\n'
 commit=subprocess.check_output(['git','log','-1','--format=%H','--',str(source/name)],cwd=source,text=True).strip()
 strong='strongSwan' in name;vpn='OpenVPN' in name
 href='https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd' if strong else 'https://github.com/OpenVPN/openvpn/tree/v2.7.4' if vpn else None
 baseline=['strongSwan 6.0.3；源码快照与本地适配边界见正文'] if strong else ['OpenVPN 2.7.4；涉及 Tongsuo 时按正文指定版本'] if vpn else ['以正文分别引用的内核、协议和工具版本为准']
 # Prefer source-provided reading estimates; never count source-code bytes as Chinese prose.
 m=re.search(r'预计精读\*\*：\s*(\d+)[–—-](\d+)',raw)
 minutes=int(m[2]) if m else max(8,math.ceil(len(re.findall(r'[\u4e00-\u9fff]',body))/260)+len(re.findall(r'^```',body,re.M))//2)
 order=entry['order']; chain=re.search(r'[五六]链源码精读 (\d+)',name)
 if chain:order=int(chain[1])
 data=dict(title=title,description=entry['description'],date='2026-09-29',updated='2026-09-29',category=entry['category'],modules=entry['modules'],editorial='original',tags=list(dict.fromkeys((['strongSwan','IKEv2'] if strong else ['OpenVPN','TLS'] if vpn else [])+[entry['series']])),kind='原稿实验记录' if historical else '源码精读' if strong or vpn else '技术笔记',minutes=minutes,featured=slug=='strongswan-child-sa-xfrm',series=entry['series'],seriesOrder=order,difficulty='进阶',prerequisites=['按正文的概念解释、源码入口与关联文章补齐前置知识'],environment=['原稿整理；本次发布未新增运行实验'],software=baseline,conclusion='source' if (strong or vpn) and not historical else 'public',realVerified=False,verificationActor='保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测',provenance=dict(title=title,mode='公开技术节选' if omissions else '原稿收录',omissions=omissions),changes=[dict(date='2026-09-29',note='收录技术原稿；调整标题层级、网页图示与站内链接。'+(' 公开版处理：'+'；'.join(omissions)+'。' if omissions else ''))])
 if href:data.update(repository=href,basis=dict(label='strongSwan 6.0.3 源码' if strong else 'OpenVPN 2.7.4 源码',href=href,boundary='上游分析、本地适配与实验记录的区别以原文标注为准。'))
 text='---\n'+'\n'.join(k+': '+json.dumps(v,ensure_ascii=False) for k,v in data.items())+'\n---\n\n'+body
 target=root/'src/content/posts'/f'{slug}.md'
 if args.check:assert target.read_text()==text, f'Imported content differs: {slug}'
 else:target.write_text(text)
 manifest.append(dict(slug=slug,document=safe_text(name),sourceCommit=commit,sourceSha256=hashlib.sha256(raw.encode()).hexdigest(),bodySha256=hashlib.sha256(body.encode()).hexdigest(),omissions=omissions))
manifest_text=json.dumps(manifest,ensure_ascii=False,indent=2)+'\n';target=root/'src/data/publication-sources.json'
if args.check:assert target.read_text()==manifest_text,'Manifest differs'
else:target.write_text(manifest_text)
print(f'{len(manifest)} original technical manuscripts '+('match catalog and sources.' if args.check else 'imported.'))
