import type { Coworker } from './types';

export const coworkers: Coworker[] = [
  {
    id: 'theme',
    code: '①',
    name: '主线交易官',
    role: '主线 / 行业景气',
    status: '在线',
    promptHint: '从市场主线、景气度和资金偏好角度回答。',
  },
  {
    id: 'topic',
    code: '②',
    name: '题材雷达',
    role: '题材 / 催化',
    status: '在线',
    promptHint: '识别题材扩散、事件催化和持续性风险。',
  },
  {
    id: 'sentiment',
    code: '③',
    name: '情绪观察员',
    role: '情绪 / 资金面',
    status: '监控中',
    promptHint: '关注市场情绪、拥挤度和交易层面的脆弱点。',
  },
  {
    id: 'value-a',
    code: '④',
    name: '价投 A',
    role: '基本面',
    status: '在线',
    promptHint: '重视商业模式、盈利质量和长期护城河。',
  },
  {
    id: 'value-b',
    code: '⑤',
    name: '价投 B',
    role: '估值',
    status: '在线',
    promptHint: '重视估值分位、预期收益和安全边际。',
  },
  {
    id: 'value-c',
    code: '⑥',
    name: '价投 C',
    role: '财务质量',
    status: '在线',
    promptHint: '重视财务报表质量、现金流和盈利可持续性。',
  },
  {
    id: 'risk',
    code: '⑦',
    name: '风控官',
    role: '风控 / 回撤',
    status: '硬阈值',
    promptHint: '优先提示回撤、仓位、流动性、集中度和事件风险。',
  },
  {
    id: 'pm',
    code: '⑧',
    name: 'PM 副官',
    role: '综合判断',
    status: '在线',
    promptHint: '把多角度信息压缩成基金经理可审批的行动建议。',
  },
  {
    id: 'compliance',
    code: '⑨',
    name: '合规记录员',
    role: '留痕 / 合规',
    status: '归档中',
    promptHint: '强调证据、假设、风险披露和可回放记录。',
  },
];

export function getCoworker(id: string): Coworker {
  return coworkers.find((coworker) => coworker.id === id) || coworkers[7];
}
