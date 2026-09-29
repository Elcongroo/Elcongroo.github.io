/** Shared publication settings. Do not put private research material in this project. */
export const site = {
  isPublic: process.env.PUBLIC_SITE === 'true',
  title: 'congroo',
  englishTitle: 'congroo’s blog',
  author: 'congroo',
  url: process.env.SITE_URL || 'https://elcongroo.github.io',
  description: 'congroo 的个人技术博客。沿 Linux 内核、IPsec / TLS 与高性能网络记录源码阅读、工程思考和独立实验。',
  github: 'https://github.com/Elcongroo',
};

export const categories = {
  linux: { label: 'Linux 内核与网络', english: 'Kernel & Networking' },
  vpn: { label: 'IPsec / TLS', english: 'IPsec & TLS' },
  performance: { label: '高性能网络', english: 'Network Performance' },
  engineering: { label: '工程思考', english: 'Engineering Notes' },
  crypto: { label: '密码工程', english: 'Cryptographic Engineering' },
  pqc: { label: '后量子迁移', english: 'PQC Migration' },
} as const;

export const conclusionStates = {
  verified: { label: '已通过实验验证', short: '实验已验证', english: 'VERIFIED' },
  source: { label: '基于源码分析', short: '源码分析', english: 'SOURCE REVIEW' },
  public: { label: '基于公开资料推断', short: '公开资料', english: 'DOCUMENT STUDY' },
  pending: { label: '尚待验证', short: '尚待验证', english: 'UNVERIFIED' },
} as const;

export const topics = [
  { id: 'linux', name: 'Linux 内核与网络', number: '01', description: '包的本地交付、转发与内核／用户态边界。', categories: ['linux'], tags: ['NAPI', 'TUN', 'XFRM'] },
  { id: 'vpn', name: 'IPsec / TLS', number: '02', description: '沿状态机、密钥与业务包读 strongSwan 和 OpenVPN。', categories: ['vpn'], tags: ['IPsec', 'TLS', 'OpenVPN'] },
  { id: 'performance', name: '高性能网络', number: '03', description: '先记录负载、队列与 CPU，再讨论卸载和高速数据路径。', categories: ['performance'], tags: ['perf', 'eBPF', 'DPDK'] },
  { id: 'crypto', name: '密码工程', number: '04', description: '算法接入协议与密钥生命周期的补充阅读。', categories: ['crypto', 'pqc'], tags: ['TLCP', 'Provider', 'PQC'] },
  { id: 'engineering', name: '工程思考', number: '05', description: '研究路线、源码阅读方法与结论边界。', categories: ['engineering'], tags: ['验证方法'] },
];

export const formatDate = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
export const categoryLabel = (key: keyof typeof categories) => categories[key].label;
