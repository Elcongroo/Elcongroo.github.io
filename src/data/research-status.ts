/** Describes editorial focus, not proficiency, product ownership, or completed delivery. */
const states = {
  focus: { label: '当前重点', note: '当前优先串联的协议与数据面。具体运行结果见各篇关联实验，不表示整个模块已验证。' },
  notes: { label: '已有技术笔记', note: '已有源码或专题笔记可读。材料覆盖的版本、依据和未验证项以正文为准。' },
  research: { label: '待验证研究', note: '用于组织接口、约束与验证问题。设计方案和补充研究不能作为已交付系统的声明。' },
  future: { label: '后续研究方向', note: '保留学习与研究入口，目前不作为个人已完成的实现或性能成果展示。' },
};
const modules: Record<string, keyof typeof states> = {
  ipsec: 'focus', tls: 'focus', xfrm: 'focus',
  linux: 'notes', crypto: 'notes', provider: 'notes',
  product: 'research', management: 'research', control: 'research', platform: 'research', performance: 'research',
  'fast-path': 'future', rdma: 'future',
};
export const researchStatus = (id: string) => ({ ...states[modules[id] ?? 'research'], kind: modules[id] ?? 'research' });
