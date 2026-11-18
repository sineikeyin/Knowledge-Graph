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
    return result('no_rule', '无适用规则', !rule.enabled ? '该规则已停用。' : input.scenario !== rule.scenario ? '当前演示规则仅适用于地层对比场景。' : '尚未确认两井为同一对应层位，本规则不适用。');
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
    triggered ? `厚度差 ${difference} m 超过演示阈值 ${threshold} m，建议人工复核层位及分层记录。` : `厚度差 ${difference} m 未超过演示阈值 ${threshold} m。`, steps, difference);
}
