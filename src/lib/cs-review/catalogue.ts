export const MODULES = [
  { id: 'algorithms', number: '01', title: '数据结构与算法', short: '数据结构', description: '从数据组织到算法执行，理解每一步的代价。' },
  { id: 'architecture', number: '02', title: '计算机组成与体系结构', short: '计算机组成', description: '数的表示、存储层次与指令执行。' },
  { id: 'os', number: '03', title: '操作系统', short: '操作系统', description: '沿着进程、内存与资源分配理解系统。' },
  { id: 'networks', number: '04', title: '计算机网络', short: '计算机网络', description: '从分层协议到端到端的数据传输。' },
  { id: 'databases', number: '05', title: '数据库系统', short: '数据库', description: '关系模型、查询、事务与一致性。' },
  { id: 'software', number: '06', title: '软件工程', short: '软件工程', description: '需求、设计、测试与软件生命周期。' },
  { id: 'ai', number: '07', title: '人工智能基础', short: '人工智能', description: '理解学习任务、评价与泛化的基本边界。' },
  { id: 'technologies', number: '08', title: '信息新技术', short: '信息新技术', description: '物联网、云计算与大数据的核心方法。' },
] as const;

export type ModuleId = (typeof MODULES)[number]['id'];
export const MODULE_IDS = MODULES.map((m) => m.id) as [ModuleId, ...ModuleId[]];
export const moduleTitle = (id: string) => MODULES.find((m) => m.id === id)?.short ?? '已归档模块';
export const TYPE_LABELS = { single: '单选题', multiple: '多选题', boolean: '判断题' } as const;
export const DIFFICULTY_LABELS = { easy: '基础', medium: '进阶', hard: '综合' } as const;

export function reviewUrl(path = ''): string {
  // The homepage is deployed at the domain root. BASE_URL also supports a future project Pages base.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/appendix/cs-review/${path.replace(/^\//, '')}`;
}
