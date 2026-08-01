// 投研工作台的内置研究样例。
//
// 这些数据只用于让尚未接入结构化数据源的页面具备完整的信息层级和交互，
// 不冒充实时公告、预测或投资建议。行情接通后仍由云端快照覆盖证券价格。

export const RESEARCH_SAMPLE_DATA_LABEL = '内置研究样例';

export type ResearchSampleTone = 'positive' | 'negative' | 'neutral';

export interface ResearchIpoItem {
  id: string;
  name: string;
  code: string;
  board: string;
  industry: string;
  dateOffset: number;
  stage: '询价' | '申购' | '缴款' | '上市';
  issuePrice: string;
  issuePe: string;
  comparablePe: string;
  note: string;
}

export const RESEARCH_IPO_ITEMS: ResearchIpoItem[] = [
  { id: 'ipo-1', name: '华芯装备', code: '787521', board: '科创板', industry: '半导体设备', dateOffset: 0, stage: '申购', issuePrice: '32.80', issuePe: '28.6x', comparablePe: '34.1x', note: '收入集中度较高，重点核验在手订单与验收节奏。' },
  { id: 'ipo-2', name: '远澜新材', code: '301728', board: '创业板', industry: '高性能材料', dateOffset: 1, stage: '询价', issuePrice: '待定', issuePe: '待定', comparablePe: '26.8x', note: '原材料价格敏感，关注募投产能消化假设。' },
  { id: 'ipo-3', name: '北辰智造', code: '732906', board: '沪市主板', industry: '工业自动化', dateOffset: 2, stage: '缴款', issuePrice: '18.60', issuePe: '22.4x', comparablePe: '25.2x', note: '下游制造业资本开支波动可能影响订单确认。' },
  { id: 'ipo-4', name: '澄海生物', code: '920137', board: '北交所', industry: '生物制品', dateOffset: 4, stage: '上市', issuePrice: '12.20', issuePe: '19.7x', comparablePe: '23.5x', note: '流通盘较小，上市初期需关注换手与价格波动。' },
  { id: 'ipo-5', name: '星图能源', code: '301759', board: '创业板', industry: '储能系统', dateOffset: 6, stage: '申购', issuePrice: '24.50', issuePe: '31.2x', comparablePe: '29.6x', note: '海外收入占比较高，汇率和贸易政策为主要变量。' },
];

export interface ResearchEarningsItem {
  code: string;
  report: string;
  dateOffset: number;
  window: string;
  revenueGrowth: string;
  profitGrowth: string;
  consensus: string;
  focus: string;
}

export const RESEARCH_EARNINGS_ITEMS: ResearchEarningsItem[] = [
  { code: '600519.XSHG', report: '中期业绩', dateOffset: 1, window: '盘后', revenueGrowth: '+10%～+13%', profitGrowth: '+11%～+14%', consensus: '稳健', focus: '批价、合同负债与渠道库存' },
  { code: '300750.XSHE', report: '中期业绩', dateOffset: 2, window: '盘后', revenueGrowth: '+8%～+15%', profitGrowth: '+12%～+20%', consensus: '偏积极', focus: '海外份额、储能毛利率与资本开支' },
  { code: '600036.XSHG', report: '中期业绩', dateOffset: 3, window: '盘后', revenueGrowth: '-1%～+3%', profitGrowth: '+2%～+6%', consensus: '中性', focus: '净息差、零售资产质量与中收' },
  { code: '688981.XSHG', report: '季度业绩', dateOffset: 5, window: '盘后', revenueGrowth: '+15%～+22%', profitGrowth: '+8%～+18%', consensus: '偏积极', focus: '产能利用率、折旧与先进制程进展' },
  { code: '000333.XSHE', report: '中期业绩', dateOffset: 7, window: '盘后', revenueGrowth: '+6%～+10%', profitGrowth: '+8%～+13%', consensus: '稳健', focus: '海外收入、汇率与 ToB 业务利润率' },
  { code: '601899.XSHG', report: '中期业绩', dateOffset: 8, window: '盘后', revenueGrowth: '+12%～+18%', profitGrowth: '+15%～+24%', consensus: '偏积极', focus: '铜金价格、矿山增量与单位成本' },
];

export interface ResearchMacroIndicator {
  id: string;
  name: string;
  period: string;
  value: string;
  previous: string;
  consensus: string;
  tone: ResearchSampleTone;
  interpretation: string;
}

export const RESEARCH_MACRO_INDICATORS: ResearchMacroIndicator[] = [
  { id: 'pmi', name: '制造业 PMI', period: '上月', value: '49.8', previous: '49.5', consensus: '49.7', tone: 'positive', interpretation: '环比修复但仍在荣枯线下，设备更新链条相对占优。' },
  { id: 'cpi', name: 'CPI 同比', period: '上月', value: '+0.7%', previous: '+0.4%', consensus: '+0.6%', tone: 'positive', interpretation: '价格温和回升，消费与上游成本传导仍需分行业验证。' },
  { id: 'ppi', name: 'PPI 同比', period: '上月', value: '-1.6%', previous: '-2.1%', consensus: '-1.8%', tone: 'positive', interpretation: '工业品通缩压力收窄，关注资源品与中游制造利润修复。' },
  { id: 'credit', name: '新增社融', period: '上月', value: '3.42万亿', previous: '2.18万亿', consensus: '3.20万亿', tone: 'positive', interpretation: '总量高于预期，需继续拆分政府债、企业中长贷和居民融资。' },
  { id: 'm2', name: 'M2 同比', period: '上月', value: '+7.5%', previous: '+7.3%', consensus: '+7.4%', tone: 'neutral', interpretation: '流动性平稳，权益定价仍取决于信用向实体传导效率。' },
  { id: 'export', name: '出口同比', period: '上月', value: '+6.8%', previous: '+5.9%', consensus: '+6.1%', tone: 'positive', interpretation: '外需韧性延续，重点观察机电、汽车与高技术产品结构。' },
];

export interface ResearchDividendItem {
  code: string;
  indicatedYield: number;
  payoutRatio: number;
  consecutiveYears: number;
  exDateOffset: number;
  stability: '高' | '中' | '观察';
  note: string;
}

export const RESEARCH_DIVIDEND_ITEMS: ResearchDividendItem[] = [
  { code: '601398.XSHG', indicatedYield: 5.8, payoutRatio: 31, consecutiveYears: 18, exDateOffset: 9, stability: '高', note: '盈利波动较低，关注净息差和资本充足率。' },
  { code: '601288.XSHG', indicatedYield: 5.6, payoutRatio: 30, consecutiveYears: 15, exDateOffset: 11, stability: '高', note: '县域业务稳定，重点核验信贷成本变化。' },
  { code: '600900.XSHG', indicatedYield: 4.9, payoutRatio: 71, consecutiveYears: 12, exDateOffset: 5, stability: '高', note: '现金流可见度较高，来水与利率是关键变量。' },
  { code: '601088.XSHG', indicatedYield: 6.7, payoutRatio: 58, consecutiveYears: 10, exDateOffset: 14, stability: '中', note: '高分红与煤价周期并存，需做盈利下行情景测试。' },
  { code: '600941.XSHG', indicatedYield: 5.1, payoutRatio: 73, consecutiveYears: 5, exDateOffset: 7, stability: '高', note: '自由现金流较稳，关注资本开支和云业务回报。' },
  { code: '601857.XSHG', indicatedYield: 6.2, payoutRatio: 51, consecutiveYears: 9, exDateOffset: 18, stability: '中', note: '分红能力受油价和上游利润波动影响。' },
  { code: '000651.XSHE', indicatedYield: 5.4, payoutRatio: 52, consecutiveYears: 11, exDateOffset: 20, stability: '中', note: '现金充裕，关注内需、渠道变革与治理变化。' },
  { code: '601318.XSHG', indicatedYield: 4.7, payoutRatio: 36, consecutiveYears: 13, exDateOffset: 16, stability: '观察', note: '寿险价值修复是提升分红可持续性的核心。' },
];

export type ResearchCalendarCategory = '宏观' | '政策' | '行业' | '公司';

export interface ResearchCalendarItem {
  id: string;
  dateOffset: number;
  time: string;
  category: ResearchCalendarCategory;
  importance: 1 | 2 | 3;
  title: string;
  detail: string;
  relatedCodes: string[];
}

export const RESEARCH_CALENDAR_ITEMS: ResearchCalendarItem[] = [
  { id: 'calendar-1', dateOffset: 0, time: '09:30', category: '政策', importance: 3, title: '重要政策例行发布窗口', detail: '关注扩内需、资本市场与产业支持相关表述。', relatedCodes: [] },
  { id: 'calendar-2', dateOffset: 0, time: '15:00', category: '行业', importance: 2, title: '新能源车月度产销跟踪', detail: '核验终端销量、出口与价格变化。', relatedCodes: ['002594.XSHE', '300750.XSHE'] },
  { id: 'calendar-3', dateOffset: 1, time: '09:30', category: '宏观', importance: 3, title: '制造业景气指标', detail: '观察新订单、生产和出厂价格分项。', relatedCodes: [] },
  { id: 'calendar-4', dateOffset: 1, time: '20:00', category: '公司', importance: 2, title: '贵州茅台中期业绩窗口', detail: '重点跟踪批价、渠道库存和合同负债。', relatedCodes: ['600519.XSHG'] },
  { id: 'calendar-5', dateOffset: 2, time: '10:00', category: '行业', importance: 2, title: '半导体设备产业交流会', detail: '关注国产化率、订单可见度与验收节奏。', relatedCodes: ['688981.XSHG', '002371.XSHE'] },
  { id: 'calendar-6', dateOffset: 3, time: '18:00', category: '公司', importance: 3, title: '宁德时代中期业绩窗口', detail: '重点跟踪海外份额、储能和盈利能力。', relatedCodes: ['300750.XSHE'] },
  { id: 'calendar-7', dateOffset: 4, time: '10:00', category: '宏观', importance: 3, title: '通胀与工业价格数据', detail: '判断需求修复与中下游利润传导。', relatedCodes: [] },
  { id: 'calendar-8', dateOffset: 5, time: '14:00', category: '政策', importance: 2, title: '数字经济专题发布会', detail: '关注算力基础设施、数据要素与应用落地。', relatedCodes: ['603019.XSHG', '688111.XSHG'] },
  { id: 'calendar-9', dateOffset: 7, time: '09:30', category: '宏观', importance: 3, title: '金融与信贷数据窗口', detail: '拆分社融结构、中长贷和居民融资。', relatedCodes: ['600036.XSHG', '000001.XSHE'] },
  { id: 'calendar-10', dateOffset: 8, time: '20:00', category: '公司', importance: 2, title: '紫金矿业业绩窗口', detail: '核验铜金产量、售价与单位成本。', relatedCodes: ['601899.XSHG'] },
];

export function researchSampleDate(offset: number, base = new Date()): string {
  const date = new Date(base);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function researchSampleDateLabel(offset: number, base = new Date()): string {
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  const date = new Date(base);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
}
