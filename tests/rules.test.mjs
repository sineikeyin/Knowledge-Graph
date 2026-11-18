import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateThicknessRule} from '../src/rules.js';
import {defaultRule, demoCases} from '../src/data.js';
const base = {scenario:'strata',aligned:true,sameBasis:true,conflict:false,targetThickness:8,referenceThickness:11,evidenceIds:['source-a','source-b']};
for (const sample of demoCases) {
  test(sample.name,()=>{
    const result=evaluateThicknessRule({...base,targetThickness:sample.target,referenceThickness:sample.reference,aligned:sample.aligned,sameBasis:sample.sameBasis,conflict:sample.conflict},defaultRule);
    assert.equal(result.status,sample.expected);
    assert.equal(result.executionStatus,'succeeded');
  });
}
test('差值恰等于阈值不触发严格大于规则',()=>assert.equal(evaluateThicknessRule({...base,referenceThickness:10},defaultRule).status,'not_triggered'));
test('空字符串、零、负数和非数值不被视为未触发',()=>{
  for(const invalid of ['',0,-1,'invalid',NaN,Infinity]) assert.equal(evaluateThicknessRule({...base,referenceThickness:invalid},defaultRule).status,'insufficient');
});
test('场景不适用与停用规则均返回无规则',()=>{
  assert.equal(evaluateThicknessRule({...base,scenario:'neighbor'},defaultRule).status,'no_rule');
  assert.equal(evaluateThicknessRule(base,{...defaultRule,enabled:false}).status,'no_rule');
});
test('阈值配置无效为执行失败',()=>assert.equal(evaluateThicknessRule(base,{...defaultRule,threshold:0}).executionStatus,'failed'));
test('结果固定输入、规则版本和证据快照',()=>{
  const rule={...defaultRule};const input={...base,evidenceIds:['a','b']};
  const result=evaluateThicknessRule(input,rule);rule.threshold=99;input.targetThickness=999;input.evidenceIds.push('c');
  assert.equal(result.rule.threshold,2);assert.equal(result.input.targetThickness,8);assert.deepEqual(result.evidenceIds,['a','b']);assert.deepEqual(result.input.evidenceIds,['a','b']);
});
