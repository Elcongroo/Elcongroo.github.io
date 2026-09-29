/** Shared publication settings. Do not put private research material in this project. */
export const site = {
  isPublic: process.env.PUBLIC_SITE === 'true',
  title: 'congroo',
  englishTitle: 'congroo’s blog',
  author: 'congroo',
  url: process.env.SITE_URL || 'https://elcongroo.github.io',
  description: 'congroo 的个人技术博客。记录编程、Linux 网络、VPN 与密码工程中的问题、学习笔记和独立实验。',
  github: 'https://github.com/Elcongroo',
};

export const categories = {
  vpn: { label: 'VPN 协议栈', english: 'VPN Protocols' },
  linux: { label: 'Linux 网络', english: 'Linux Networking' },
  crypto: { label: '密码工程', english: 'Cryptographic Engineering' },
  pqc: { label: '后量子迁移', english: 'PQC Migration' },
  performance: { label: '网关性能', english: 'Gateway Performance' },
  engineering: { label: '工程接管', english: 'Engineering Ownership' },
} as const;

export const conclusionStates = {
  verified: { label: '已通过实验验证', short: '实验已验证', english: 'VERIFIED' },
  source: { label: '基于源码分析', short: '源码分析', english: 'SOURCE REVIEW' },
  public: { label: '基于公开资料推断', short: '公开资料', english: 'DOCUMENT STUDY' },
  pending: { label: '尚待验证', short: '尚待验证', english: 'UNVERIFIED' },
} as const;

export const topics = [
  { id: 'vpn', name: '协议栈', number: '01', description: 'IKE、TLS 与隧道里的控制和数据。', categories: ['vpn'], tags: ['IPsec', 'OpenVPN'] },
  { id: 'linux', name: 'Linux 数据面', number: '02', description: '从 Socket 到 TUN、XFRM 与转发路径。', categories: ['linux', 'performance'], tags: ['TUN', 'XFRM'] },
  { id: 'crypto', name: '密码工程', number: '03', description: '算法怎样进入协议与密钥生命周期。', categories: ['crypto', 'pqc'], tags: ['TLCP', 'Provider', 'PQC'] },
  { id: 'engineering', name: '工程与验证', number: '04', description: '把源码、构建身份与运行结果对应起来。', categories: ['engineering'], tags: ['验证方法'] },
];

export const formatDate = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
export const categoryLabel = (key: keyof typeof categories) => categories[key].label;
