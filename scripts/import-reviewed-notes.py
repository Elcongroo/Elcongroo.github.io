"""Publish selected reviewed Markdown without rewriting its technical prose.
Usage: python3 scripts/import-reviewed-notes.py /path/to/docs [--check]
Only these named upstream-source notes are eligible; never imports a whole repository.
"""
from pathlib import Path
import sys, re, json, hashlib, subprocess
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).resolve()
check='--check' in sys.argv
entries=[
 ('linux-packet-path','Linux内核收发包路径：NAPI、sk_buff、路由与Socket.md','linux','Linux 网络系统',1,20,['Linux','NAPI','sk_buff','Socket'],'一个包从网卡进入 Linux 以后，怎样被送给本机进程或转发出去；反向发送时又怎样到达网卡。'),
 ('tun-packet-path','Linux虚拟网络：Namespace、veth、Bridge与TUN.md','linux','Linux 网络系统',2,20,['Linux','Namespace','veth','Bridge','TUN'],'Namespace 决定网络空间，veth 连接端点，Bridge 转发二层帧，TUN 把三层 IP 包交给用户态。'),
 ('strongswan-key-derivation','strongSwan 五链源码精读 03 Proposal与KE到密钥.md','crypto','strongSwan 五链源码精读',3,20,['strongSwan','IKEv2','KDF','IPsec'],'区分 Proposal、密钥交换和 KDF，沿 keymat_v2 追踪 IKE 与 CHILD_SA 的双向密钥，再对照 IKEv1 路径。'),
 ('strongswan-child-sa-xfrm','strongSwan 五链源码精读 04 CHILD_SA到XFRM.md','vpn','strongSwan 五链源码精读',4,20,['strongSwan','IPsec','XFRM','Netlink'],'沿 install_child_sa、child_sa、kernel_interface 和 kernel-netlink，追踪协商结果如何变成 Linux XFRM state 与 policy。'),
 ('openvpn-data-channel-keys','OpenVPN 六链源码精读 03 TLS握手到数据通道密钥.md','vpn','OpenVPN 六链源码精读',3,15,['OpenVPN','TLS','TLCP','KDF','DCO'],'TLS 握手与认证之后，追踪 Key Method 2、数据 cipher 协商、双向密钥派生，以及用户态和 DCO 的安装分支。'),
 ('tls-openvpn-data-channel','OpenVPN 六链源码精读 04 TUN明文到外层密文.md','vpn','OpenVPN 六链源码精读',4,15,['OpenVPN','TLS','TUN','AEAD'],'从 read_incoming_tun 到 process_outgoing_link，跟踪一个业务 IP 包的缓冲区、密钥选择、加密和外层封装。'),
 ('vpn-performance-profile','Linux网络性能与排障：队列、软中断、观测与高速路径.md','performance','Linux 网络系统',3,20,['perf','NAPI','RSS','AF_XDP','DPDK'],'把网卡队列、软中断、CPU 分布、卸载、XFRM 和 OpenVPN 用户态放到同一张性能地图中，按计数与 Profile 定位瓶颈。'),
]
manifest=[]
for slug,name,category,series,order,minutes,tags,description in entries:
 raw=(source/name).read_text()
 title=raw.splitlines()[0].removeprefix('# ')
 body=raw.split('\n',1)[1]
 body=re.sub(r'<!-- reading-stats:start -->.*?<!-- reading-stats:end -->\n?', '', body,flags=re.S)
 omissions=[]
 if slug=='vpn-performance-profile':
  body=re.sub(r'## 11\. 配套快照工具怎样使用\n.*?(?=## 12\.)','',body,flags=re.S)
  omissions=['第 11 节配套快照工具（未随本次选刊发布）']
 # MkDocs admonition syntax becomes Markdown blockquotes; all wording is retained.
 body=re.sub(r'^!!! \w+ "([^"]+)"\n((?:    .*\n|\n)+)',lambda m:'> **'+m[1]+'**\n'+''.join('> '+line[4:]+'\n' if line.startswith('    ') else '>\n' for line in m[2].splitlines())+'\n',body,flags=re.M)
 body=body.strip()+'\n'
 commit=subprocess.check_output(['git','log','-1','--format=%H','--',str(source/name)],cwd=source,text=True).strip()
 strong='strongSwan' in name
 vpn='OpenVPN' in name
 baseline='strongSwan 6.0.3 / 472dcd8bb50a91f156b725ff56992352b573f7dd' if strong else 'OpenVPN 2.7.4 / v2.7.4 / 8e9e91f' if vpn else 'Linux；原文未固定统一内核版本，具体调用与接口须核对目标版本'
 href='https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd' if strong else 'https://github.com/OpenVPN/openvpn/tree/v2.7.4' if vpn else 'https://docs.kernel.org/networking/index.html'
 data=dict(title=title,description=description,date='2026-09-29',updated='2026-09-29',category=category,tags=tags,kind='源码精读' if strong or vpn else '技术笔记',minutes=minutes,featured=slug=='strongswan-child-sa-xfrm',series=series,seriesOrder=order,difficulty='进阶',prerequisites=['基本 IP 路由与用户态／内核态概念'],environment=['文档选刊；本次发布未新增运行实验'],software=[baseline],conclusion='source' if strong or vpn else 'public',realVerified=False,verificationActor='原文源码解读与资料分析；不标记为实测结果',repository=href,basis=dict(label='strongSwan 6.0.3 源码' if strong else 'OpenVPN 2.7.4 源码' if vpn else 'Linux 官方文档',href=href,boundary='保留 VPN 文档原文的技术推导；版本和验证边界见正文。'),provenance=dict(title=title,mode='节选' if omissions else '原文选刊',omissions=omissions),changes=[dict(date='2026-09-29',note='按 VPN 文档原文选刊，保留技术内容、源码坐标和图示；调整网页排版与站内链接。'+(' 本次未选刊原文第 11 节配套脚本部分。' if omissions else ''))])
 text='---\n'+'\n'.join(k+': '+json.dumps(v,ensure_ascii=False) for k,v in data.items())+'\n---\n\n'+body
 target=root/'src/content/posts'/f'{slug}.md'
 if check:
  assert target.read_text()==text, f'Imported content differs: {slug}'
 else:
  old=target.with_suffix('.mdx')
  if old.exists():old.unlink()
  target.write_text(text)
 manifest.append(dict(slug=slug,document=name,sourceCommit=commit,sourceSha256=hashlib.sha256(raw.encode()).hexdigest(),bodySha256=hashlib.sha256(body.encode()).hexdigest(),omissions=omissions))
manifest_text=json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
manifest_path=root/'src/data/publication-sources.json'
if check:assert manifest_path.read_text()==manifest_text,'Manifest differs'
else:manifest_path.write_text(manifest_text)
print(f'{len(entries)} reviewed source notes '+('match original imports.' if check else 'imported.'))
