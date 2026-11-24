// 所有资料均为本地样例数据，不代表真实井、专家规则或正式测试结果。


export const objectTypes = [
  { id: 'stratum', name: '地层分层', icon: 'layers', type: '地层', count: 1 },
  { id: 'log', name: '测井资料', icon: 'file', type: '测井', count: 2 },
  { id: 'trajectory', name: '井轨迹', icon: 'well', type: '井轨迹', count: 1 },
  { id: 'model', name: '地质模型', icon: 'graph', type: '地质模型', count: 1 },
  { id: 'instruction', name: '历史导向指令', icon: 'rule', type: '历史导向指令', count: 1 },
];
export const defaultRule = {
  id: 'DEMO-RULE-001', name: '同层位厚度差复核规则', version: 'demo-v1.0',
  threshold: 2, unit: 'm', enabled: true,
  scenario: 'strata', source: '分享对话中的示例规则（待专家确认）',
  description: '两井层位已确认对应，单位及深度基准一致，厚度差绝对值超过阈值时标记待复核。',
};
export const defaultNeighborRule = {
  id: 'DEMO-NEIGHBOR-001', name: '邻井可参考性规则', version: 'demo-v1.0',
  maxThicknessDifference: 2, unit: 'm', enabled: true,
  scenario: 'neighbor', source: '邻井推荐示例规则（待专家确认）',
  description: '候选井与目标井层位一致且在搜索范围内时，厚度资料完整且厚度差不超过阈值则推荐参考；超过阈值标记待复核。',
};
export const demoCases = [
  { id: 'triggered', name: '厚度差超限 · 8 m / 11 m', target: 8, reference: 11, aligned: true, sameBasis: true, conflict: false, expected: 'triggered' },
  { id: 'not_triggered', name: '未触发 · 8 m / 9 m', target: 8, reference: 9, aligned: true, sameBasis: true, conflict: false, expected: 'not_triggered' },
  { id: 'missing', name: '资料不足 · 参考井厚度缺失', target: 8, reference: null, aligned: true, sameBasis: true, conflict: false, expected: 'insufficient' },
  { id: 'unmatched', name: '无适用规则 · 层位未确认对应', target: 8, reference: 11, aligned: false, sameBasis: true, conflict: false, expected: 'no_rule' },
  { id: 'basis', name: '基准不一致 · 暂不可比', target: 8, reference: 11, aligned: true, sameBasis: false, conflict: false, expected: 'insufficient' },
  { id: 'conflict', name: '规则冲突 · 待人工处理', target: 8, reference: 11, aligned: true, sameBasis: true, conflict: true, expected: 'conflict' },
];

export const moduleDefinitions = {
  data: { name: '数据接入与治理', code: 'M2', description: '浏览当前井的资料清单，查看来源、版本与处理状态。', features: ['连接器与资料导入', '随钻实时接入', '文档解析与 OCR', '主数据归一', '数据质量校验', '血缘与版本', '数据资产目录'] },
  ontology: { name: '本体与 Schema 管理', code: 'M3', description: '定义知识对象、关系、属性与业务约束。', features: ['可视化本体建模', '行业本体模板', '术语与同义词', '版本与变更审批', '数据源映射', '业务动作定义'] },
  construction: { name: '知识抽取与构建', code: 'M4', description: '从专业资料形成候选知识，经人工校核后发布。', features: ['构建流水线', '地学实体识别', '关系抽取', '人工校验', '表格与曲线头段抽取', '抽取质量评价', '增量更新'] },
  graph: { name: '图谱管理与关系查询', code: 'M5', description: '通过井与井段关联地层、测井、轨迹、模型和历史指令。', features: ['混合存储关联', '多跳路径查询', '空间邻近计算', '相似井检索', '图算法', '时序与版本', '快照与恢复'] },
  retrieval: { name: '混合检索与问答', code: 'M6', features: ['混合检索', '证据问答', '来源与证据', '权限感知检索'] },
  reasoning: { name: '规则与推理', code: 'M7', features: ['专家规则与关联', '知识推理与依据', '典型井与回归', '图谱与大模型联合分析'] },
  integration: { name: '开放接口与软件联调', code: 'M12', description: '分别记录图谱接口及智能体／目标软件联调链路。', features: ['查询与推理接口', '目标软件适配', '接口鉴权与稳定性', '智能体工具调用'] },
  users: { name: '用户与权限管理', code: 'M1', description: '管理用户、组织、授权范围与操作审计。', features: ['用户与组织', '登录与身份认证', '对象及字段权限', '操作审计'] },
  operations: { name: '部署与运行管理', code: 'M13', description: '查看运行记录、备份恢复、安全与部署状态。', features: ['日志与监控', '备份与恢复', '脱敏与导出保护', '私有化部署'] },
};
