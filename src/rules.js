// 确定性规则判定，与大模型分析分离。返回执行状态、业务结果、步骤和输入快照。
export function evaluateThicknessRule(input, rule) {
  const measured = value => value === null || value === undefined || value === '' ? null : Number(value);
  const target = measured(input.targetThickness);
  const reference = measured(input.referenceThickness);
  const snapshot = { ...input, evidenceIds: [...(input.evidenceIds || [])], targetThickness: target, referenceThickness: reference };
  const result = (status, title, reason, steps = [], difference = null) => ({
    executionStatus: 'succeeded', status, title, reason, steps, difference,
    input: snapshot, rule: { ...rule }, evidenceIds: [...(input.evidenceIds || [])],
  });
  if (!rule.enabled || input.scenario !== rule.scenario || input.aligned !== true) {
    return result('no_rule', '无适用规则', !rule.enabled ? '该规则已停用。' : input.scenario !== rule.scenario ? '当前示例规则仅适用于地层对比场景。' : '尚未确认两井为同一对应层位，本规则不适用。');
  }
  if (input.conflict) return result('conflict', '规则冲突，待人工处理', '当前样例包含相互冲突的适用规则；解决冲突前不生成最终业务判断。');
  if (input.sameBasis !== true) return result('insufficient', '资料不足，暂时无法判断', '两井的单位或深度基准尚未统一，厚度差不可直接比较。');
  if (![target, reference].every(v => v !== null && Number.isFinite(v) && v > 0)) {
    return result('insufficient', '资料不足，暂时无法判断', '需要两井有效且大于零的厚度。缺失、非数值或无效厚度不按零值处理。');
  }
  const threshold = Number(rule.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { ...result('error', '规则配置无效', '规则阈值必须为大于零的有效数值。'), executionStatus: 'failed' };
  }
  const difference = Number(Math.abs(target - reference).toFixed(6));
  const triggered = difference > threshold;
  const steps = [
    { name: '层位对应', actual: '已确认对应', condition: '两井属于同一对应层位', passed: true },
    { name: '单位与基准', actual: 'm / 同一深度基准', condition: '单位、深度基准一致', passed: true },
    { name: '厚度完整性', actual: `${target} m / ${reference} m`, condition: '两井厚度均有效且大于零', passed: true },
    { name: '厚度差判断', actual: `|${target} − ${reference}| = ${difference} m`, condition: `绝对差值 > ${threshold} m`, passed: triggered },
  ];
  return result(triggered ? 'triggered' : 'not_triggered', triggered ? '需要提示风险：厚度差待复核' : '未触发规则',
    triggered ? `厚度差 ${difference} m 超过示例阈值 ${threshold} m，建议人工复核层位及分层记录。` : `厚度差 ${difference} m 未超过示例阈值 ${threshold} m。`, steps, difference);
}

// 邻井可参考性的确定性判定，与地层厚度差规则并列。返回状态、业务结论、步骤和输入快照。
export function evaluateNeighborRule(input, rule) {
  const measured = value => value === null || value === undefined || value === '' ? null : Number(value);
  const targetThickness = measured(input.targetThickness);
  const candidateThickness = measured(input.candidateThickness);
  const distance = measured(input.distance);
  const radius = measured(input.radius);
  const layerMatch = input.layerMatch === true;
  const withinRange = input.withinRange === true;
  const dataComplete = input.dataComplete === true
    && Number.isFinite(targetThickness) && targetThickness > 0
    && Number.isFinite(candidateThickness) && candidateThickness > 0;
  const maximum = Number(rule.maxThicknessDifference);
  const snapshot = {
    ...input,
    evidenceIds: [...(input.evidenceIds || [])],
    targetThickness,
    candidateThickness,
    distance,
    radius,
  };
  const result = (status, title, reason, steps = [], difference = null) => ({
    executionStatus: 'succeeded', status, title, reason, steps, difference,
    input: snapshot, rule: { ...rule }, evidenceIds: [...(input.evidenceIds || [])],
  });
  const difference = Number.isFinite(targetThickness) && Number.isFinite(candidateThickness)
    ? Number(Math.abs(targetThickness - candidateThickness).toFixed(6))
    : null;
  const steps = [
    { name: '层位一致', actual: `${input.targetLayer || '缺失'} / ${input.candidateLayer || '缺失'}`, condition: '两井属于同一层位', passed: layerMatch },
    { name: '搜索范围', actual: Number.isFinite(distance) ? `${distance} km` : '缺失', condition: `不超过 ${Number.isFinite(radius) ? radius : '—'} km`, passed: withinRange },
    { name: '厚度完整性', actual: `${Number.isFinite(targetThickness) ? targetThickness : '缺失'} m / ${Number.isFinite(candidateThickness) ? candidateThickness : '缺失'} m`, condition: '两井厚度均有效且大于零', passed: dataComplete },
    { name: '厚度差异', actual: difference === null ? '缺失' : `|${targetThickness} − ${candidateThickness}| = ${difference} m`, condition: `不超过 ${Number.isFinite(maximum) ? maximum : '—'} m`, passed: difference !== null && difference <= maximum },
  ];
  if (!rule.enabled || input.scenario !== rule.scenario) {
    return result('no_rule', '无适用规则', !rule.enabled ? '该规则已停用。' : '当前示例规则仅适用于邻井推荐场景。', steps, difference);
  }
  if (!Number.isFinite(maximum) || maximum <= 0) {
    return { ...result('error', '规则配置无效', '邻井厚度差阈值必须为大于零的有效数值。', steps, difference), executionStatus: 'failed' };
  }
  if (!layerMatch) {
    return result('not_recommended', '层位不一致，不建议作为主要参考', '候选井层位与目标井不一致，不能作为同层位对比的参考井。', steps, difference);
  }
  if (!withinRange) {
    return result('not_recommended', '超出搜索范围，不建议作为主要参考', Number.isFinite(distance) ? `候选井距离 ${distance} km，超过当前搜索半径 ${radius} km。` : '候选井距离缺失，不能确认在搜索范围内。', steps, difference);
  }
  if (!dataComplete) {
    return result('insufficient', '资料不足，暂不能推荐', '需要两井有效且大于零的厚度；缺失或无效厚度不被当作零值处理。', steps, difference);
  }
  if (difference > maximum) {
    return result('review', '可参考，但厚度差异需复核', `厚度差 ${difference} m 超过示例阈值 ${maximum} m，建议核对分层记录和测井曲线后再参考。`, steps, difference);
  }
  return result('recommended', '可作为参考邻井', `两井层位一致、距离 ${distance} km 在搜索范围内，厚度差 ${difference} m 未超过示例阈值 ${maximum} m。`, steps, difference);
}