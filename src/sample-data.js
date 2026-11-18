export const seedProjects = [
  { id: 'p1', name: '鄂尔多斯示例工区', block: '示例区块 A', owner: '演示用户', wells: ['w1', 'w2', 'w3'] },
  { id: 'p2', name: '松辽示例工区', block: '示例区块 B', owner: '演示用户', wells: ['w4', 'w5'] },
];
export const seedWells = [
  { id: 'w1', name: '示例井 JH-01', short: 'JH-01', layer: '长 8₁', depth: '3,120–3,128 m', thickness: 8, distance: 0, source: 'JH-01 分层记录', version: 'data-v1.0' },
  { id: 'w2', name: '示例井 JH-02', short: 'JH-02', layer: '长 8₁', depth: '3,108–3,119 m', thickness: 11, distance: 1.6, source: 'JH-02 分层记录', version: 'data-v1.0' },
  { id: 'w3', name: '示例井 JH-03', short: 'JH-03', layer: '长 8₂', depth: '3,096–3,105 m', thickness: 9, distance: 2.8, source: 'JH-03 分层记录', version: 'data-v1.0' },
  { id: 'w4', name: '示例井 SL-01', short: 'SL-01', layer: '扶余油层', depth: '1,420–1,428 m', thickness: 8, distance: 0, source: 'SL-01 分层记录', version: 'data-v1.0' },
  { id: 'w5', name: '示例井 SL-02', short: 'SL-02', layer: '扶余油层', depth: '1,411–1,422 m', thickness: 11, distance: 1.9, source: 'SL-02 分层记录', version: 'data-v1.0' },
];
export const seedTasks = [
  { id: 'demo-task-01', name: '分层资料知识审核', type: '人工校核', wellId: 'w1', state: '待审核', tone: 'amber', time: '演示记录', route: 'construction' },
  { id: 'demo-task-02', name: '同层位厚度差复核', type: '规则判定', wellId: 'w1', state: '待运行', tone: 'blue', time: '演示记录', route: 'retrieval' },
  { id: 'demo-task-03', name: '地层关系来源核查', type: '关系校核', wellId: 'w2', state: '待核查', tone: 'amber', time: '演示记录', route: 'graph' },
];
