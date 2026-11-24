// 联合分析的可重复示例实现：只解释规则判定和已授权证据，不伪造大模型输出。
export const JOINT_PROVIDER = Object.freeze({
  id: 'local-evidence-v1',
  name: '本地证据归纳器',
  model: 'deterministic-template',
  templateVersion: 'jp-strata-evidence-v1',
  isModel: false,
  simulated: false,
});
export const DEMO_LLM_PROVIDER = Object.freeze({
  id: 'demo-llm-v1',
  name: 'GeoReasoner 示例模型',
  model: 'geo-reasoner-demo-0.1',
  templateVersion: 'jp-llm-demo-v1',
  isModel: false,
  simulated: true,
});

const STATUS_TONE = {
  triggered: 'amber',
  not_triggered: 'teal',
  insufficient: 'slate',
  no_rule: 'slate',
  conflict: 'amber',
  recommended: 'teal',
  review: 'amber',
  not_recommended: 'slate',
  error: 'slate',
};

const deepClone = value => JSON.parse(JSON.stringify(value));

function numberLabel(value) {
  return value === null || value === undefined || value === '' ? '缺失' : `${value}`;
}

function uniqueCitations(items) {
  const seen = new Set();
  return items.filter(item => item && !seen.has(item.id) && seen.add(item.id));
}

function citationIdsFor(citations) {
  return citations.map(item => item.id);
}

function buildJointAnalysisBase({run, targetWell, referenceWell, evidence = [], provider = JOINT_PROVIDER, now = new Date()} = {}) {
  if (!run?.result) throw new Error('联合分析需要一条已完成的规则判定。');
  if (!targetWell || !referenceWell) throw new Error('联合分析缺少目标井或参考井。');

  const status = run.result.status || 'error';
  const input = run.result.input || {};
  const rule = run.result.rule || {};
  const tone = STATUS_TONE[status] || 'slate';
  const scenario = input.scenario || run.scenario || 'strata';
  const activeProvider = {...provider,templateVersion:provider.simulated?provider.templateVersion:scenario==='neighbor'?'jp-neighbor-evidence-v1':provider.templateVersion};

  const wellCitations = evidence
    .filter(item => item && item.id)
    .map(item => ({
      id: item.id,
      kind: item.kind || 'stratum',
      role: item.role || 'evidence',
      label: item.label || '分层记录',
      detail: item.detail || '',
      source: item.source || '来源受限',
      version: item.version || '—',
      wellId: item.wellId || '',
    }));
  const targetCitation = wellCitations.find(item => item.role === 'target') || null;
  const referenceCitation = wellCitations.find(item => item.role === 'reference') || null;
  const ruleCitation = {
    id: `ev:rule:${rule.id || 'unknown'}:${rule.version || 'unknown'}`,
    kind: 'rule',
    role: 'rule',
    label: `${rule.name || '示例规则'}（${rule.version || '未标注版本'}）`,
    detail: `阈值 ${numberLabel(rule.threshold ?? rule.maxThicknessDifference)} ${rule.unit || 'm'}；${rule.description || '未提供规则说明'}`,
    source: rule.source || '规则来源未标注',
    version: rule.version || '—',
    wellId: '',
  };
  const runCitation = {
    id: `ev:run:${run.id || 'unknown'}`,
    kind: 'run',
    role: 'run',
    label: `规则判定 ${run.id || '未编号'}`,
    detail: `${run.result.title || '未命名结论'}；${run.result.reason || '未提供原因'}`,
    source: '规则判定运行记录',
    version: rule.version || '—',
    wellId: '',
  };
  const citations = uniqueCitations([...wellCitations, ruleCitation, runCitation]);
  const targetEvidence = targetCitation ? [targetCitation] : [];
  const referenceEvidence = referenceCitation ? [referenceCitation] : [];
  const bothEvidence = [...targetEvidence, ...referenceEvidence];

  if (scenario === 'neighbor') {
    const targetLayer = input.targetLayer || targetWell.layer || '未标注层位';
    const candidateLayer = input.candidateLayer || referenceWell.layer || '未标注层位';
    const distance = input.distance;
    const radius = input.radius;
    const targetThickness = input.targetThickness;
    const candidateThickness = input.candidateThickness;
    const maxDifference = rule.maxThicknessDifference;
    const focus = input.focus || '';
    const layerMatch = input.layerMatch === true;
    const withinRange = input.withinRange === true;
    let conclusion;
    if (status === 'recommended') {
      conclusion = { tone, title: '可作为参考邻井', summary: `${targetLayer} 与候选井层位一致，距离 ${numberLabel(distance)} km 在搜索半径 ${numberLabel(radius)} km 内，厚度差 ${numberLabel(run.result.difference)} m 未超过示例阈值 ${numberLabel(maxDifference)} m。` };
    } else if (status === 'review') {
      conclusion = { tone, title: '可参考，但厚度差异需复核', summary: `候选井与目标井层位一致且在搜索范围内，但厚度差 ${numberLabel(run.result.difference)} m 超过示例阈值 ${numberLabel(maxDifference)} m。建议核对分层记录与测井曲线后再参考。` };
    } else if (status === 'not_recommended') {
      conclusion = { tone, title: run.result.title || '不建议作为主要参考', summary: run.result.reason || '候选井不满足层位或空间范围条件。' };
    } else if (status === 'insufficient') {
      conclusion = { tone, title: '资料不足，暂不能推荐', summary: run.result.reason || '候选井或目标井的厚度、距离资料不足。' };
    } else if (status === 'no_rule') {
      conclusion = { tone, title: '无适用规则，不能形成推荐', summary: run.result.reason || '当前没有可执行的邻井可参考性规则。' };
    } else {
      conclusion = { tone, title: '邻井判定执行失败，未形成推荐', summary: run.result.reason || '规则判定未成功完成。' };
    }
    const reasons = [
      { text: `目标井层位为 ${targetLayer}，候选井层位为 ${candidateLayer}；${layerMatch ? '两者一致' : '两者不一致'}。`, citationIds: citationIdsFor([...bothEvidence, runCitation]) },
      { text: `候选井距离 ${numberLabel(distance)} km，当前搜索半径 ${numberLabel(radius)} km；${withinRange ? '在范围内' : '超出范围'}。`, citationIds: citationIdsFor([...bothEvidence, runCitation]) },
      { text: `目标井厚度 ${numberLabel(targetThickness)} m，候选井厚度 ${numberLabel(candidateThickness)} m，绝对差为 ${numberLabel(run.result.difference)} m；示例阈值为 ${numberLabel(maxDifference)} m。`, citationIds: citationIdsFor([...bothEvidence, ruleCitation, runCitation]) },
    ];
    if (focus) {
      reasons.push({ text: `本次关注问题：“${focus}”。联合分析只基于现有事实与规则，不把关注问题当成已证实结论。`, citationIds: citationIdsFor([runCitation]) });
    }
    const supporting = [...bothEvidence, { ...ruleCitation }, { ...runCitation }];
    const opposing = [];
    if (status === 'review') {
      opposing.push({ text: `厚度差 ${numberLabel(run.result.difference)} m 超过示例阈值 ${numberLabel(maxDifference)} m；可参考性需人工复核。`, citationIds: citationIdsFor([...bothEvidence, ruleCitation]) });
    }
    if (status === 'not_recommended') {
      opposing.push({ text: layerMatch ? '候选井超出当前搜索范围，不能作为本次邻井推荐的依据。' : '候选井与目标井层位不一致，不能直接用于同层位对比。', citationIds: citationIdsFor([...bothEvidence, runCitation]) });
    }
    const uncertainties = [
      { text: '当前只使用示例分层记录与距离字段，未纳入测井曲线、邻井历史案例和现场导向指令；推荐结果只用于验证流程。', citationIds: citationIdsFor([...bothEvidence, runCitation]) },
      { text: '邻井可参考不等于可以直接套用导向参数；实际应用仍需专家结合原始资料判断。', citationIds: citationIdsFor([...bothEvidence, ruleCitation]) },
    ];
    if (Number(maxDifference) === 2) {
      uncertainties.push({ text: '厚度差阈值 2 m 来自示例规则，不是行业标准或专家已审定值。', citationIds: citationIdsFor([ruleCitation]) });
    }
    if (!provider.isModel && !provider.simulated) {
      uncertainties.push({ text: '本次由本地确定性模板生成，未调用大语言模型，不能作为 T4 大模型效果的最终验收证据。', citationIds: citationIdsFor([runCitation]) });
    }
    return {
      scenario,
      status,
      generatedAt: now.toISOString(),
      provider: { ...activeProvider },
      conclusion,
      reasons,
      supporting,
      opposing,
      uncertainties,
      citations,
      evidenceCoverage: { available: wellCitations.length, required: 2, label: `${wellCitations.length}/2 条关键分层记录` },
      inputSnapshot: deepClone({ run, targetWell, referenceWell, evidence }),
      disclaimer: provider.isModel ? '分析结果由已配置模型生成，仍需专家结合原始资料复核。' : '本地证据归纳 · 未调用外部大模型 · 不得作为现场导向指令。',
    };
  }

  if (scenario !== 'strata') {
    return {
      scenario,
      status: 'unsupported',
      generatedAt: now.toISOString(),
      provider: { ...activeProvider },
      conclusion: {
        tone: 'slate',
        title: '当前场景的联合分析尚未开放',
        summary: '当前版本已开放地层对比和邻井推荐，其他场景尚未接入。',
      },
      reasons: [],
      supporting: [],
      opposing: [],
      uncertainties: [{
        text: '未生成分析结论，避免把仅有的规则判定误当成业务结果。',
        citationIds: citationIdsFor([ruleCitation]),
      }],
      citations,
      evidenceCoverage: { available: wellCitations.length, required: 2, label: `${wellCitations.length}/2 条关键分层记录` },
      inputSnapshot: deepClone({ run, targetWell, referenceWell, evidence }),
      disclaimer: '本地流程提示：该场景联合分析尚未实现。',
    };
  }

  const difference = run.result.difference;
  const threshold = rule.threshold;
  const layer = targetWell.layer || referenceWell.layer || '未标注层位';
  const targetName = targetWell.short || '目标井';
  const referenceName = referenceWell.short || '参考井';
  const targetThickness = input.targetThickness;
  const referenceThickness = input.referenceThickness;

  let conclusion;
  if (status === 'triggered') {
    conclusion = {
      tone,
      title: '厚度差超限，建议人工复核',
      summary: `${targetName} 与 ${referenceName} 的 ${layer} 厚度差为 ${numberLabel(difference)} m，超过示例阈值 ${numberLabel(threshold)} m。建议复核分层记录、层位对应关系和原始测井曲线。`,
    };
  } else if (status === 'not_triggered') {
    conclusion = {
      tone,
      title: '厚度差未超过阈值',
      summary: `${targetName} 与 ${referenceName} 的 ${layer} 厚度差为 ${numberLabel(difference)} m，未超过示例阈值 ${numberLabel(threshold)} m。规则未触发，但不代表层位对应关系绝对正确。`,
    };
  } else if (status === 'insufficient') {
    conclusion = {
      tone,
      title: '现有证据不足，暂不形成结论',
      summary: `当前缺少可比厚度、统一单位或深度基准，不能把缺失资料按“未触发”处理。原因：${run.result.reason || '资料不足'}`,
    };
  } else if (status === 'no_rule') {
    conclusion = {
      tone,
      title: '无适用规则，不能形成业务判断',
      summary: `当前场景没有可执行的专家规则。原因：${run.result.reason || '规则不适用'}。联合分析不会替代规则判断。`,
    };
  } else if (status === 'conflict') {
    conclusion = {
      tone,
      title: '规则冲突，需人工裁决',
      summary: '样例中存在相互冲突的适用规则，系统没有静默选择结论。请先由专家确认规则优先级，再重新运行判定与联合分析。',
    };
  } else {
    conclusion = {
      tone,
      title: '规则执行失败，未形成结论',
      summary: run.result.reason || '规则判定未成功完成，不能继续生成业务分析。',
    };
  }

  const reasons = [];
  if (['triggered', 'not_triggered'].includes(status)) {
    reasons.push({
      text: `${targetName} 厚度 ${numberLabel(targetThickness)} m，${referenceName} 厚度 ${numberLabel(referenceThickness)} m，绝对差为 ${numberLabel(difference)} m。`,
      citationIds: citationIdsFor([...bothEvidence, runCitation]),
    });
    reasons.push({
      text: `系统按“${rule.name || '示例规则'}”比较绝对差与阈值 ${numberLabel(threshold)} ${rule.unit || 'm'}，得到“${run.result.title}”。`,
      citationIds: citationIdsFor([ruleCitation, runCitation]),
    });
    reasons.push({
      text: `两井记录均来自 ${layer} 示例分层资料，版本分别为 ${targetWell.version || '—'} 与 ${referenceWell.version || '—'}。`,
      citationIds: citationIdsFor([...bothEvidence]),
    });
  } else if (status === 'insufficient') {
    reasons.push({
      text: `规则判定为“资料不足”，因此联合分析不把缺失值、零值或非数值当作未触发。`,
      citationIds: citationIdsFor([runCitation, ruleCitation]),
    });
    reasons.push({
      text: `具体原因：${run.result.reason || '关键输入缺失或深度基准不一致'}。`,
      citationIds: citationIdsFor([ruleCitation, runCitation]),
    });
  } else if (status === 'no_rule') {
    reasons.push({
      text: `系统没有为当前分析对象选出适用规则，因而不会生成风险提示或“未触发”结论。`,
      citationIds: citationIdsFor([ruleCitation, runCitation]),
    });
    reasons.push({
      text: `不适用原因：${run.result.reason || '场景或层位对应条件不满足'}。`,
      citationIds: citationIdsFor([runCitation]),
    });
  } else if (status === 'conflict') {
    reasons.push({
      text: `当前工况被标记为存在相反规则结论，系统保留冲突状态并转人工处理。`,
      citationIds: citationIdsFor([ruleCitation, runCitation]),
    });
    reasons.push({
      text: `冲突原因：${run.result.reason || '同一工况存在相互冲突的适用规则'}。`,
      citationIds: citationIdsFor([runCitation]),
    });
  } else {
    reasons.push({
      text: `规则执行状态为 ${run.result.executionStatus || '未知'}，未产生可用于联合分析的业务结论。`,
      citationIds: citationIdsFor([runCitation]),
    });
  }

  const supporting = [];
  if (targetCitation) supporting.push({ ...targetCitation });
  if (referenceCitation) supporting.push({ ...referenceCitation });
  supporting.push({ ...ruleCitation });
  supporting.push({ ...runCitation });

  const opposing = [];
  if (status === 'not_triggered' && Number.isFinite(Number(difference))) {
    opposing.push({
      text: `厚度仍存在 ${numberLabel(difference)} m 差异；未触发只说明没有超过当前示例阈值，不能据此排除分层误差。`,
      citationIds: citationIdsFor([...bothEvidence]),
    });
  }
  if (status === 'conflict') {
    opposing.push({
      text: '冲突规则尚未展示完整候选列表，需人工确认适用优先级后再判断。',
      citationIds: citationIdsFor([ruleCitation]),
    });
  }

  const uncertainties = [{
    text: '当前只使用了示例分层记录，未纳入测井曲线、邻井历史案例和现场导向指令，结论仅用于验证“事实 → 规则 → 证据”的分析流程。',
    citationIds: citationIdsFor([...bothEvidence, runCitation]),
  }];
  if (Number(threshold) === 2) {
    uncertainties.push({
      text: '阈值 2 m 来自分享对话中的示例，不是行业标准或专家已审定规则。',
      citationIds: citationIdsFor([ruleCitation]),
    });
  }
  if (status === 'insufficient') {
    uncertainties.push({
      text: '“资料不足”不等于“未触发”；补齐厚度或统一基准后必须重新运行规则判定。',
      citationIds: citationIdsFor([ruleCitation, runCitation]),
    });
  }
  if (!provider.isModel && !provider.simulated) {
    uncertainties.push({
      text: '本次由本地确定性模板生成，未调用大语言模型，不能作为 T4 大模型效果的最终验收证据。',
      citationIds: citationIdsFor([runCitation]),
    });
  }

  return {
    scenario,
    status,
    generatedAt: now.toISOString(),
    provider: { ...activeProvider },
    conclusion,
    reasons,
    supporting,
    opposing,
    uncertainties,
    citations,
    evidenceCoverage: {
      available: wellCitations.length,
      required: 2,
      label: `${wellCitations.length}/2 条关键分层记录`,
    },
    inputSnapshot: deepClone({ run, targetWell, referenceWell, evidence }),
    disclaimer: provider.isModel
      ? '分析结果由已配置模型生成，仍需专家结合原始资料复核。'
      : '本地证据归纳 · 未调用外部大模型 · 不得作为现场导向指令。',
  };
}

function finalizeDemoAnalysis(result, provider) {
  if (!provider.simulated) return result;
  const limitations = result.uncertainties.map(item => item.text);
  return {
    ...result,
    analysisMode: 'demo-llm',
    model: {
      name: provider.name,
      modelId: provider.model,
      promptTemplateVersion: provider.templateVersion,
      provider: '示例运行',
      simulated: true,
    },
    modelNotice: '示例模式：本报告基于当前规则判定和授权证据组织，用于展示联合分析报告结构。',
    narrative: {
      executiveSummary: `${result.conclusion.title}。${result.conclusion.summary}`,
      reasoningChain: result.reasons.map(item => item.text),
      evidenceAssessment: `本次分析引用 ${result.supporting.length} 条证据，覆盖 ${result.evidenceCoverage?.label || '—'}；所有结论均带引用编号。`,
      recommendation: ['recommended','not_triggered'].includes(result.status)
        ? '可将该结果作为辅助参考，但仍需专家结合原始分层资料和测井曲线复核。'
        : ['review','triggered'].includes(result.status)
          ? '建议先人工复核关键差异，再决定是否采用该判断。'
          : '当前不宜形成最终业务结论，请补齐资料或交由专家处理。',
      limitations: [...limitations, '示例模式：报告用于展示分析结构，不替代真实模型效果验收。'],
    },
    disclaimer: '示例模式 · 结果用于展示分析报告结构 · 不得作为现场导向指令。',
  };
}
export function buildJointAnalysis({run, targetWell, referenceWell, evidence = [], provider = JOINT_PROVIDER, mode = 'local', now = new Date()} = {}) {
  const chosen = mode === 'demo-llm' ? DEMO_LLM_PROVIDER : provider;
  return finalizeDemoAnalysis(buildJointAnalysisBase({run, targetWell, referenceWell, evidence, provider: chosen, now}), chosen);
}
