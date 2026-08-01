// 投研工作台的数据与业务逻辑层（无 React 依赖，便于单元测试）。
// - 内置约 40 只 A 股样例目录，用确定性伪随机序列生成可复现的行情；
// - JQData（聚宽）可用时，用真实价格覆盖样例快照；
// - 实盘记录账户：手工录入资金、成交和持仓，全部本地持久化，不连接券商；
// - 为拖拽到对话框生成自然语言 prompt，供 Agent 使用。

export type ResearchOrderSide = 'buy' | 'sell';
export type ResearchCashFlowSide = 'deposit' | 'withdraw';

export const RESEARCH_DRAG_MIME = 'application/x-alpha-research-context';

// ---- 证券目录与行情 ---------------------------------------------------------

export interface ResearchCatalogEntry {
  code: string;
  name: string;
  board: string;
  sector: string;
  /** 标的类型；内置 ETF 使用它在离线样例中保持正确分类。 */
  securityType?: 'stock' | 'etf';
  basePrice: number;
  /** 总股本（亿股），用于推算市值和成交额 */
  shares: number;
  tags: string[];
  thesis: string;
}

export interface ResearchBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface ResearchQuote {
  code: string;
  name: string;
  board: string;
  sector: string;
  /** 云端行情标的类型；旧缓存和内置样例可能为空。 */
  securityType?: 'stock' | 'etf' | 'index';
  price: number;
  prevClose: number;
  changePct: number;
  changeAmt: number;
  open?: number;
  high: number;
  low: number;
  /** 成交量（万手） */
  volume: number;
  /** 成交额（亿元） */
  turnover: number;
  /** 总市值（亿元） */
  marketCap: number;
  /** 成交量（股，来自真实数据时可用） */
  volumeShares?: number;
  /** 成交额（元，来自真实数据时可用） */
  turnoverAmount?: number;
  /** 换手率（%，来自实时行情源时可用） */
  turnoverRate?: number;
  /** 量比，来自实时行情源时可用 */
  volumeRatio?: number;
  highLimit?: number;
  lowLimit?: number;
  paused?: boolean;
  dataDate?: string;
  tags: string[];
  thesis: string;
  source: ResearchQuoteSource;
}

export type ResearchQuoteSource = 'sample' | 'jqdata' | 'eastmoney' | 'tencent';

export const RESEARCH_CATALOG: ResearchCatalogEntry[] = [
  { code: '600519.XSHG', name: '贵州茅台', board: '沪市主板', sector: '白酒', basePrice: 1518.8, shares: 12.6, tags: ['核心资产', '高ROE'], thesis: '消费龙头，跟踪批价、估值中枢和机构仓位变化。' },
  { code: '000858.XSHE', name: '五粮液', board: '深市主板', sector: '白酒', basePrice: 143.2, shares: 38.8, tags: ['消费', '核心资产'], thesis: '高端白酒对照样本，观察渠道和动销修复。' },
  { code: '000568.XSHE', name: '泸州老窖', board: '深市主板', sector: '白酒', basePrice: 128.6, shares: 14.7, tags: ['消费'], thesis: '次高端弹性标的，关注库存去化节奏。' },
  { code: '000001.XSHE', name: '平安银行', board: '深市主板', sector: '银行', basePrice: 11.42, shares: 194.1, tags: ['低估值', '高股息'], thesis: '低估值银行样本，观察息差和资产质量。' },
  { code: '600036.XSHG', name: '招商银行', board: '沪市主板', sector: '银行', basePrice: 35.08, shares: 252.2, tags: ['零售金融', '高股息'], thesis: '优质银行代表，观察零售恢复与估值修复。' },
  { code: '601398.XSHG', name: '工商银行', board: '沪市主板', sector: '银行', basePrice: 5.62, shares: 3564.1, tags: ['国有大行', '高股息'], thesis: '国有大行红利样本，跟踪股息率与资金面。' },
  { code: '601288.XSHG', name: '农业银行', board: '沪市主板', sector: '银行', basePrice: 4.65, shares: 3499.8, tags: ['国有大行', '高股息'], thesis: '县域金融占比高，观察规模扩张的持续性。' },
  { code: '300750.XSHE', name: '宁德时代', board: '创业板', sector: '电池', basePrice: 206.4, shares: 44.0, tags: ['新能源', '成长'], thesis: '电池链核心，观察海外需求、毛利率和产能利用率。' },
  { code: '300014.XSHE', name: '亿纬锂能', board: '创业板', sector: '电池', basePrice: 48.3, shares: 20.5, tags: ['新能源'], thesis: '二线电池弹性样本，跟踪储能订单和价格战。' },
  { code: '002594.XSHE', name: '比亚迪', board: '深市主板', sector: '汽车', basePrice: 251.6, shares: 29.1, tags: ['新能源车', '出口'], thesis: '整车龙头，跟踪销量、出口和智能化进展。' },
  { code: '601633.XSHG', name: '长城汽车', board: '沪市主板', sector: '汽车', basePrice: 26.8, shares: 85.4, tags: ['整车', '出口'], thesis: '越野与出口结构改善，观察单车利润变化。' },
  { code: '688981.XSHG', name: '中芯国际', board: '科创板', sector: '半导体', basePrice: 54.7, shares: 79.4, tags: ['国产替代', '先进制造'], thesis: '国产替代主线，跟踪产能利用率与资本开支。' },
  { code: '603501.XSHG', name: '韦尔股份', board: '沪市主板', sector: '半导体', basePrice: 108.2, shares: 12.2, tags: ['CIS', '设计'], thesis: '手机与车载 CIS 复苏样本，观察库存周期。' },
  { code: '002371.XSHE', name: '北方华创', board: '深市主板', sector: '半导体', basePrice: 328.5, shares: 5.3, tags: ['设备', '国产替代'], thesis: '设备国产化核心，跟踪订单与交付节奏。' },
  { code: '688206.XSHG', name: '概伦电子', board: '科创板', sector: '半导体', basePrice: 40.6, shares: 4.3, tags: ['EDA'], thesis: 'EDA 国产化样本，弹性大、波动高。' },
  { code: '000063.XSHE', name: '中兴通讯', board: '深市主板', sector: '通信设备', basePrice: 32.4, shares: 47.8, tags: ['算力', '主设备'], thesis: '算力与运营商资本开支双线索。' },
  { code: '600498.XSHG', name: '烽火通信', board: '沪市主板', sector: '通信设备', basePrice: 18.9, shares: 11.8, tags: ['光通信'], thesis: '光通信弹性样本，观察数通订单。' },
  { code: '601698.XSHG', name: '中国卫通', board: '沪市主板', sector: '通信设备', basePrice: 14.2, shares: 39.6, tags: ['卫星', '商业航天'], thesis: '商业航天主题核心，事件驱动明显。' },
  { code: '301191.XSHE', name: '菲菱科思', board: '创业板', sector: '通信设备', basePrice: 135.0, shares: 1.0, tags: ['交换机'], thesis: '网络设备代工弹性标的，注意流通盘小。' },
  { code: '600900.XSHG', name: '长江电力', board: '沪市主板', sector: '电力', basePrice: 28.4, shares: 244.7, tags: ['水电', '高股息'], thesis: '类债资产定价样本，观察利率与来水。' },
  { code: '601985.XSHG', name: '中国核电', board: '沪市主板', sector: '电力', basePrice: 11.8, shares: 188.9, tags: ['核电'], thesis: '核电成长确定性样本，跟踪核准与投产。' },
  { code: '600030.XSHG', name: '中信证券', board: '沪市主板', sector: '证券', basePrice: 26.9, shares: 148.2, tags: ['券商龙头'], thesis: '市场贝塔代表，观察成交额与政策周期。' },
  { code: '300059.XSHE', name: '东方财富', board: '创业板', sector: '证券', basePrice: 21.7, shares: 158.6, tags: ['互联网券商'], thesis: '零售交易活跃度的高弹性代理。' },
  { code: '002475.XSHE', name: '立讯精密', board: '深市主板', sector: '消费电子', basePrice: 38.9, shares: 72.4, tags: ['果链'], thesis: '消费电子链核心，观察大客户订单与汽车业务。' },
  { code: '002241.XSHE', name: '歌尔股份', board: '深市主板', sector: '消费电子', basePrice: 24.6, shares: 34.2, tags: ['声学', 'XR'], thesis: 'XR 与声学复苏样本，弹性大。' },
  { code: '300684.XSHE', name: '中石科技', board: '创业板', sector: '消费电子', basePrice: 74.4, shares: 3.0, tags: ['散热'], thesis: '散热材料主题标的，跟随大客户创新周期。' },
  { code: '300408.XSHE', name: '三环集团', board: '创业板', sector: '元件', basePrice: 36.8, shares: 19.2, tags: ['陶瓷元件'], thesis: 'MLCC 与陶瓷件复苏样本。' },
  { code: '002138.XSHE', name: '顺络电子', board: '深市主板', sector: '元件', basePrice: 29.5, shares: 8.1, tags: ['电感'], thesis: '被动元件景气度代理，观察稼动率。' },
  { code: '301308.XSHE', name: '江波龙', board: '创业板', sector: '元件', basePrice: 681.8, shares: 4.2, tags: ['存储'], thesis: '存储涨价主线，价格弹性大、波动高。' },
  { code: '600276.XSHG', name: '恒瑞医药', board: '沪市主板', sector: '医药', basePrice: 46.2, shares: 63.8, tags: ['创新药'], thesis: '创新药龙头，跟踪出海授权与管线进展。' },
  { code: '603259.XSHG', name: '药明康德', board: '沪市主板', sector: '医药', basePrice: 58.7, shares: 29.2, tags: ['CXO'], thesis: 'CXO 景气代理，关注海外订单与地缘扰动。' },
  { code: '601318.XSHG', name: '中国平安', board: '沪市主板', sector: '保险', basePrice: 48.2, shares: 182.1, tags: ['高股息', '金融'], thesis: '保险龙头，观察负债端修复与权益弹性。' },
  { code: '601628.XSHG', name: '中国人寿', board: '沪市主板', sector: '保险', basePrice: 36.4, shares: 282.6, tags: ['寿险'], thesis: '纯寿险贝塔样本，跟随权益市场波动。' },
  { code: '000651.XSHE', name: '格力电器', board: '深市主板', sector: '家电', basePrice: 41.5, shares: 56.3, tags: ['高股息', '白电'], thesis: '白电现金流样本，观察分红与渠道改革。' },
  { code: '000333.XSHE', name: '美的集团', board: '深市主板', sector: '家电', basePrice: 74.8, shares: 76.6, tags: ['白电', '出口'], thesis: '家电全球化代表，跟踪 ToB 业务占比提升。' },
  { code: '688111.XSHG', name: '金山办公', board: '科创板', sector: '软件', basePrice: 286.3, shares: 4.6, tags: ['AI应用', 'SaaS'], thesis: 'AI 应用落地样本，跟踪订阅与 AI 付费转化。' },
  { code: '688039.XSHG', name: '当虹科技', board: '科创板', sector: '软件', basePrice: 43.6, shares: 0.9, tags: ['视频AI'], thesis: '视频 AI 主题标的，事件驱动为主。' },
  { code: '603019.XSHG', name: '中科曙光', board: '沪市主板', sector: '算力', basePrice: 62.3, shares: 14.6, tags: ['服务器', '国产算力'], thesis: '国产算力整机代表，观察液冷与芯片配套。' },
  { code: '000977.XSHE', name: '浪潮信息', board: '深市主板', sector: '算力', basePrice: 48.9, shares: 14.7, tags: ['AI服务器'], thesis: 'AI 服务器出货代理，跟踪毛利率变化。' },
  { code: '000725.XSHE', name: '京东方A', board: '深市主板', sector: '面板', basePrice: 7.76, shares: 376.4, tags: ['面板周期'], thesis: '面板周期定价样本，观察稼动率与价格。' },
  { code: '600048.XSHG', name: '保利发展', board: '沪市主板', sector: '房地产', basePrice: 10.3, shares: 119.7, tags: ['央企地产', '高股息'], thesis: '地产链政策和销售修复观察样本。' },
  { code: '000002.XSHE', name: '万科A', board: '深市主板', sector: '房地产', basePrice: 7.4, shares: 119.3, tags: ['地产', '信用修复'], thesis: '民营/混合地产龙头，观察销售、融资和存量资产处置。' },
  { code: '601012.XSHG', name: '隆基绿能', board: '沪市主板', sector: '光伏', basePrice: 18.8, shares: 75.8, tags: ['光伏', '制造'], thesis: '光伏主链价格战样本，关注硅片/组件盈利底部。' },
  { code: '688599.XSHG', name: '天合光能', board: '科创板', sector: '光伏', basePrice: 21.6, shares: 21.8, tags: ['光伏组件', '储能'], thesis: '组件与储能双线索，观察海外需求和库存去化。' },
  { code: '002466.XSHE', name: '天齐锂业', board: '深市主板', sector: '锂矿', basePrice: 41.2, shares: 16.4, tags: ['锂矿', '周期'], thesis: '锂价弹性标的，跟踪库存和澳矿定价。' },
  { code: '603799.XSHG', name: '华友钴业', board: '沪市主板', sector: '有色金属', basePrice: 33.5, shares: 17.1, tags: ['钴镍', '新能源材料'], thesis: '新能源材料周期样本，观察镍钴价格和海外项目。' },
  { code: '601899.XSHG', name: '紫金矿业', board: '沪市主板', sector: '有色金属', basePrice: 16.9, shares: 263.3, tags: ['铜金', '资源'], thesis: '全球资源龙头，跟踪铜金价格和矿山增量。' },
  { code: '600547.XSHG', name: '山东黄金', board: '沪市主板', sector: '黄金', basePrice: 28.7, shares: 44.7, tags: ['黄金', '避险'], thesis: '黄金价格和实际利率变化的权益映射。' },
  { code: '600309.XSHG', name: '万华化学', board: '沪市主板', sector: '化工', basePrice: 82.6, shares: 31.4, tags: ['MDI', '化工龙头'], thesis: '化工龙头，观察地产链需求和新材料产能释放。' },
  { code: '600887.XSHG', name: '伊利股份', board: '沪市主板', sector: '食品饮料', basePrice: 28.1, shares: 63.7, tags: ['乳制品', '消费'], thesis: '大众消费修复样本，关注收入增长和利润率。' },
  { code: '603288.XSHG', name: '海天味业', board: '沪市主板', sector: '食品饮料', basePrice: 38.2, shares: 55.6, tags: ['调味品', '消费'], thesis: '调味品龙头，观察渠道库存和餐饮景气度。' },
  { code: '601888.XSHG', name: '中国中免', board: '沪市主板', sector: '旅游零售', basePrice: 72.5, shares: 20.7, tags: ['免税', '消费复苏'], thesis: '免税和出行消费样本，跟踪客流、折扣和毛利率。' },
  { code: '000895.XSHE', name: '双汇发展', board: '深市主板', sector: '食品饮料', basePrice: 25.6, shares: 34.6, tags: ['肉制品', '防御'], thesis: '稳定现金流消费品，观察猪价和成本传导。' },
  { code: '600809.XSHG', name: '山西汾酒', board: '沪市主板', sector: '白酒', basePrice: 188.4, shares: 12.2, tags: ['清香白酒', '消费'], thesis: '白酒扩张样本，观察省外增速和费用投入。' },
  { code: '000776.XSHE', name: '广发证券', board: '深市主板', sector: '证券', basePrice: 14.8, shares: 76.2, tags: ['券商', '财富管理'], thesis: '券商业绩弹性样本，跟踪成交额和投行业务。' },
  { code: '601688.XSHG', name: '华泰证券', board: '沪市主板', sector: '证券', basePrice: 16.2, shares: 90.8, tags: ['券商', '机构业务'], thesis: '综合券商样本，观察财富管理和衍生品业务。' },
  { code: '601601.XSHG', name: '中国太保', board: '沪市主板', sector: '保险', basePrice: 29.7, shares: 96.2, tags: ['保险', '高股息'], thesis: '保险修复样本，跟踪新业务价值和权益弹性。' },
  { code: '601166.XSHG', name: '兴业银行', board: '沪市主板', sector: '银行', basePrice: 18.6, shares: 207.7, tags: ['股份行', '高股息'], thesis: '股份行息差和资产质量观察样本。' },
  { code: '600000.XSHG', name: '浦发银行', board: '沪市主板', sector: '银行', basePrice: 9.2, shares: 293.5, tags: ['股份行', '低估值'], thesis: '低估值金融样本，观察风险出清和分红稳定性。' },
  { code: '600050.XSHG', name: '中国联通', board: '沪市主板', sector: '通信运营', basePrice: 5.4, shares: 318.0, tags: ['运营商', '算力网络'], thesis: '运营商重估样本，跟踪云网融合和分红。' },
  { code: '600941.XSHG', name: '中国移动', board: '沪市主板', sector: '通信运营', basePrice: 106.0, shares: 213.6, tags: ['运营商', '高股息'], thesis: '高股息运营商龙头，观察算力资本开支回报。' },
  { code: '601728.XSHG', name: '中国电信', board: '沪市主板', sector: '通信运营', basePrice: 6.4, shares: 915.1, tags: ['运营商', '云计算'], thesis: '云网与政企数字化样本，关注利润率和分红。' },
  { code: '601857.XSHG', name: '中国石油', board: '沪市主板', sector: '石油石化', basePrice: 9.7, shares: 1830.2, tags: ['能源', '高股息'], thesis: '油价和央企重估样本，跟踪上游利润和分红。' },
  { code: '600028.XSHG', name: '中国石化', board: '沪市主板', sector: '石油石化', basePrice: 6.5, shares: 1217.4, tags: ['炼化', '高股息'], thesis: '炼化和成品油需求样本，观察油价价差。' },
  { code: '601088.XSHG', name: '中国神华', board: '沪市主板', sector: '煤炭', basePrice: 40.8, shares: 198.7, tags: ['煤炭', '高股息'], thesis: '煤炭红利资产，观察煤价和长协稳定性。' },
  { code: '600019.XSHG', name: '宝钢股份', board: '沪市主板', sector: '钢铁', basePrice: 7.1, shares: 222.7, tags: ['钢铁', '高股息'], thesis: '制造业需求和原料价差样本。' },
  { code: '601600.XSHG', name: '中国铝业', board: '沪市主板', sector: '有色金属', basePrice: 7.9, shares: 171.6, tags: ['铝', '资源'], thesis: '电解铝景气样本，跟踪铝价和电力成本。' },
  { code: '600584.XSHG', name: '长电科技', board: '沪市主板', sector: '半导体', basePrice: 34.6, shares: 17.9, tags: ['封测', '半导体'], thesis: '封测周期复苏样本，观察先进封装需求。' },
  { code: '688012.XSHG', name: '中微公司', board: '科创板', sector: '半导体', basePrice: 167.0, shares: 6.2, tags: ['设备', '国产替代'], thesis: '刻蚀设备核心，跟踪订单和国产替代进度。' },
  { code: '688008.XSHG', name: '澜起科技', board: '科创板', sector: '半导体', basePrice: 78.5, shares: 11.4, tags: ['内存接口', 'AI'], thesis: 'AI 服务器内存链样本，跟踪 DDR5 和 MRDIMM。' },
  { code: '688041.XSHG', name: '海光信息', board: '科创板', sector: '算力', basePrice: 92.3, shares: 23.2, tags: ['国产CPU', '算力'], thesis: '国产算力芯片样本，关注信创订单和生态。' },
  { code: '002230.XSHE', name: '科大讯飞', board: '深市主板', sector: 'AI应用', basePrice: 47.6, shares: 23.1, tags: ['大模型', 'AI应用'], thesis: 'AI 应用商业化样本，跟踪教育/办公场景落地。' },
  { code: '300308.XSHE', name: '中际旭创', board: '创业板', sector: '光通信', basePrice: 178.0, shares: 8.0, tags: ['CPO', 'AI算力'], thesis: 'AI 光模块核心，观察海外云厂商资本开支。' },
  { code: '300502.XSHE', name: '新易盛', board: '创业板', sector: '光通信', basePrice: 122.5, shares: 7.1, tags: ['光模块', 'AI算力'], thesis: '高速光模块弹性样本，跟踪 800G/1.6T 订单。' },
  { code: '600570.XSHG', name: '恒生电子', board: '沪市主板', sector: '金融科技', basePrice: 31.2, shares: 19.0, tags: ['金融IT', 'AI应用'], thesis: '金融 IT 周期样本，观察券商和资管系统投入。' },
  { code: '002415.XSHE', name: '海康威视', board: '深市主板', sector: '安防', basePrice: 31.9, shares: 93.3, tags: ['安防', 'AI视觉'], thesis: '安防与机器视觉龙头，关注海外需求和 AI 产品化。' },
  { code: '510300.XSHG', name: '沪深300ETF', board: '沪市ETF', sector: '宽基ETF', securityType: 'etf', basePrice: 4.12, shares: 920, tags: ['宽基', '大盘'], thesis: '大盘核心资产的场内配置工具，重点比较规模、流动性和跟踪误差。' },
  { code: '510500.XSHG', name: '中证500ETF', board: '沪市ETF', sector: '宽基ETF', securityType: 'etf', basePrice: 6.18, shares: 185, tags: ['宽基', '中盘'], thesis: '中盘风格配置工具，观察小盘风格相对强弱与成交活跃度。' },
  { code: '510050.XSHG', name: '上证50ETF', board: '沪市ETF', sector: '宽基ETF', securityType: 'etf', basePrice: 2.86, shares: 475, tags: ['宽基', '蓝筹'], thesis: '沪市大盘蓝筹配置工具，关注金融与消费权重影响。' },
  { code: '159915.XSHE', name: '创业板ETF', board: '深市ETF', sector: '宽基ETF', securityType: 'etf', basePrice: 2.31, shares: 410, tags: ['宽基', '成长'], thesis: '创业板成长风格配置工具，波动通常高于大盘宽基。' },
  { code: '588000.XSHG', name: '科创50ETF', board: '沪市ETF', sector: '宽基ETF', securityType: 'etf', basePrice: 1.06, shares: 980, tags: ['宽基', '科创'], thesis: '科创板核心公司配置工具，关注半导体和高端制造权重。' },
  { code: '512480.XSHG', name: '半导体ETF', board: '沪市ETF', sector: '行业ETF', securityType: 'etf', basePrice: 1.12, shares: 345, tags: ['行业', '半导体'], thesis: '半导体产业链工具，适合观察行业景气与国产替代主线。' },
  { code: '515790.XSHG', name: '光伏ETF', board: '沪市ETF', sector: '行业ETF', securityType: 'etf', basePrice: 0.72, shares: 160, tags: ['行业', '新能源'], thesis: '光伏产业链工具，重点跟踪供需、价格与产能出清。' },
  { code: '512800.XSHG', name: '银行ETF', board: '沪市ETF', sector: '行业ETF', securityType: 'etf', basePrice: 1.28, shares: 95, tags: ['行业', '高股息'], thesis: '银行板块配置工具，关注息差、资产质量与分红稳定性。' },
  { code: '518880.XSHG', name: '黄金ETF', board: '沪市ETF', sector: '商品ETF', securityType: 'etf', basePrice: 6.24, shares: 82, tags: ['商品', '黄金'], thesis: '黄金价格场内映射工具，关注实际利率、美元与避险需求。' },
  { code: '511010.XSHG', name: '国债ETF', board: '沪市ETF', sector: '债券ETF', securityType: 'etf', basePrice: 142.4, shares: 8.6, tags: ['债券', '低波动'], thesis: '利率债配置工具，适合观察无风险利率与股债跷跷板。' },
];

export interface ResearchIndexEntry {
  code: string;
  name: string;
  basePrice: number;
}

export const RESEARCH_INDEXES: ResearchIndexEntry[] = [
  { code: '000001.XSHG', name: '上证指数', basePrice: 3428.6 },
  { code: '399001.XSHE', name: '深证成指', basePrice: 10682.4 },
  { code: '399006.XSHE', name: '创业板指', basePrice: 2214.8 },
  { code: '000300.XSHG', name: '沪深300', basePrice: 4012.2 },
  { code: '000905.XSHG', name: '中证500', basePrice: 5836.5 },
  { code: '000688.XSHG', name: '科创50', basePrice: 1034.7 },
];

// ---- 确定性伪随机行情 -------------------------------------------------------

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tradingDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const month = String(cursor.getMonth() + 1).padStart(2, '0');
      const date = String(cursor.getDate()).padStart(2, '0');
      dates.push(`${cursor.getFullYear()}-${month}-${date}`);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates.reverse();
}

/** 用代码作种子生成可复现的日线序列（最早在前）。 */
export function sampleBars(code: string, basePrice: number, count = 60): ResearchBar[] {
  const rand = mulberry32(hashSeed(code));
  const dates = tradingDates(count);
  const drift = (rand() - 0.5) * 0.004;
  const volatility = 0.008 + rand() * 0.02;
  const bars: ResearchBar[] = [];
  // 先倒推一个起点，让最后一根 K 线落在 basePrice 附近。
  let close = basePrice * (0.86 + rand() * 0.28);
  for (let i = 0; i < count; i += 1) {
    const changePct = Math.max(-0.098, Math.min(0.098, drift + (rand() * 2 - 1) * volatility));
    const open = close;
    close = Math.max(0.2, open * (1 + changePct));
    const high = Math.max(open, close) * (1 + rand() * volatility * 0.6);
    const low = Math.min(open, close) * (1 - rand() * volatility * 0.6);
    const volume = Math.round((0.4 + rand()) * 1_000_000);
    bars.push({ date: dates[i], open, close, high, low, volume });
  }
  // 缩放整条序列，让最新收盘价严格等于 basePrice，涨跌幅保持不变。
  const scale = basePrice / bars[bars.length - 1].close;
  return bars.map((bar) => ({
    ...bar,
    open: bar.open * scale,
    close: bar.close * scale,
    high: bar.high * scale,
    low: bar.low * scale,
  }));
}

function quoteFromEntry(entry: ResearchCatalogEntry): ResearchQuote {
  const bars = sampleBars(entry.code, entry.basePrice, 60);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const rand = mulberry32(hashSeed(`${entry.code}:meta`));
  const price = last.close;
  const prevClose = prev.close;
  const changeAmt = price - prevClose;
  const changePct = prevClose > 0 ? (changeAmt / prevClose) * 100 : 0;
  const volume = (0.5 + rand() * 4) * entry.shares;
  return {
    code: entry.code,
    name: entry.name,
    board: entry.board,
    sector: entry.sector,
    securityType: entry.securityType ?? 'stock',
    price,
    prevClose,
    changePct,
    changeAmt,
    open: last.open,
    high: last.high,
    low: last.low,
    volume,
    // volume 单位是万手（1e6 股），turnover 换算成亿元。
    turnover: (volume * price) / 100,
    marketCap: price * entry.shares,
    turnoverRate: 0.6 + rand() * 7.8,
    volumeRatio: 0.55 + rand() * 2.25,
    tags: entry.tags,
    thesis: entry.thesis,
    source: 'sample',
  };
}

export interface LivePriceOverride {
  source?: Exclude<ResearchQuoteSource, 'sample'>;
  date?: string;
  price: number;
  prevClose: number | null;
  open?: number;
  high?: number;
  low?: number;
  volumeShares?: number;
  turnoverAmount?: number;
  marketCapAmount?: number;
  turnoverRate?: number;
  volumeRatio?: number;
  highLimit?: number;
  lowLimit?: number;
  paused?: boolean;
}

/**
 * 汇总样例目录 + 用户自定义证券的行情快照。
 * `overrides` 里的 JQData 实时价会覆盖样例价格并重算涨跌。
 */
export function buildQuoteMap(
  state: ResearchState,
  overrides?: Map<string, LivePriceOverride> | null,
): Map<string, ResearchQuote> {
  const map = new Map<string, ResearchQuote>();
  for (const entry of RESEARCH_CATALOG) {
    map.set(entry.code, quoteFromEntry(entry));
  }
  for (const [code, custom] of Object.entries(state.customSecurities)) {
    if (map.has(code)) continue;
    map.set(code, quoteFromEntry({
      code,
      name: custom.name,
      board: boardFromCode(code),
      sector: custom.sector || '其他',
      basePrice: custom.basePrice || 20,
      shares: 10,
      tags: [],
      thesis: '',
    }));
  }
  if (overrides) {
    for (const [code, live] of overrides) {
      const quote = map.get(code);
      if (!quote || !Number.isFinite(live.price) || live.price <= 0) continue;
      const prevClose = live.prevClose && live.prevClose > 0 ? live.prevClose : quote.prevClose;
      const changeAmt = live.price - prevClose;
      const priceRatio = quote.price > 0 ? live.price / quote.price : 1;
      const volume =
        live.volumeShares && live.volumeShares > 0
          ? live.volumeShares / 1_000_000
          : quote.volume;
      const turnover =
        live.turnoverAmount && live.turnoverAmount > 0
          ? live.turnoverAmount / 100_000_000
          : quote.turnover * priceRatio;
      const marketCap =
        live.marketCapAmount && live.marketCapAmount > 0
          ? live.marketCapAmount / 100_000_000
          : quote.marketCap * priceRatio;
      map.set(code, {
        ...quote,
        price: live.price,
        prevClose,
        changeAmt,
        changePct: prevClose > 0 ? (changeAmt / prevClose) * 100 : 0,
        open: live.open,
        high: live.high && live.high > 0 ? live.high : Math.max(quote.high, live.price),
        low: live.low && live.low > 0 ? live.low : Math.min(quote.low, live.price),
        volume,
        turnover,
        marketCap,
        volumeShares: live.volumeShares,
        turnoverAmount: live.turnoverAmount,
        turnoverRate: live.turnoverRate,
        volumeRatio: live.volumeRatio,
        highLimit: live.highLimit,
        lowLimit: live.lowLimit,
        paused: live.paused,
        dataDate: live.date,
        source: live.source ?? 'jqdata',
      });
    }
  }
  return map;
}

export interface ResearchIndexQuote {
  code: string;
  name: string;
  price: number;
  prevClose: number;
  changePct: number;
  changeAmt: number;
  source: ResearchQuoteSource;
}

export function buildIndexQuotes(
  overrides?: Map<string, LivePriceOverride> | null,
): ResearchIndexQuote[] {
  return RESEARCH_INDEXES.map((entry) => {
    const bars = sampleBars(entry.code, entry.basePrice, 40);
    let price = bars[bars.length - 1].close;
    let prevClose = bars[bars.length - 2].close;
    let source: ResearchQuoteSource = 'sample';
    const live = overrides?.get(entry.code);
    if (live && Number.isFinite(live.price) && live.price > 0) {
      prevClose = live.prevClose && live.prevClose > 0 ? live.prevClose : prevClose;
      price = live.price;
      source = live.source ?? 'jqdata';
    }
    const changeAmt = price - prevClose;
    return {
      code: entry.code,
      name: entry.name,
      price,
      prevClose,
      changePct: prevClose > 0 ? (changeAmt / prevClose) * 100 : 0,
      changeAmt,
      source,
    };
  });
}

export function boardFromCode(code: string): string {
  if (code.startsWith('688')) return '科创板';
  if (code.startsWith('30')) return '创业板';
  if (code.endsWith('.XSHG')) return '沪市主板';
  return '深市主板';
}

/** 把用户输入（600519 / 600519.XSHG / sh600519）归一化成聚宽代码格式。 */
export function normalizeSecurityCode(input: string): string | null {
  const raw = input.trim().toUpperCase();
  const withSuffix = raw.match(/^(\d{6})\.(XSHG|XSHE)$/);
  if (withSuffix) return `${withSuffix[1]}.${withSuffix[2]}`;
  const prefixed = raw.match(/^(SH|SZ)(\d{6})$/);
  if (prefixed) return `${prefixed[2]}.${prefixed[1] === 'SH' ? 'XSHG' : 'XSHE'}`;
  const bare = raw.match(/^\d{6}$/);
  if (!bare) return null;
  const code = bare[0];
  if (code.startsWith('6')) return `${code}.XSHG`;
  return `${code}.XSHE`;
}

// ---- 市场统计（热力图 / 涨跌分布） ------------------------------------------

export interface MarketDistributionBucket {
  id: string;
  label: string;
  count: number;
  tone: 'up' | 'down' | 'flat';
}

export interface MarketOverview {
  upCount: number;
  downCount: number;
  flatCount: number;
  buckets: MarketDistributionBucket[];
}

export function computeMarketOverview(quotes: Iterable<ResearchQuote>): MarketOverview {
  const list = Array.from(quotes);
  const bucketDefs: Array<{ id: string; label: string; tone: 'up' | 'down' | 'flat'; test: (pct: number) => boolean }> = [
    { id: 'limit-down', label: '跌停', tone: 'down', test: (pct) => pct <= -9.8 },
    { id: 'down-7', label: '≤-7%', tone: 'down', test: (pct) => pct > -9.8 && pct <= -7 },
    { id: 'down-5', label: '-7~-5%', tone: 'down', test: (pct) => pct > -7 && pct <= -5 },
    { id: 'down-3', label: '-5~-3%', tone: 'down', test: (pct) => pct > -5 && pct <= -3 },
    { id: 'down-0', label: '-3~0%', tone: 'down', test: (pct) => pct > -3 && pct < 0 },
    { id: 'flat', label: '0', tone: 'flat', test: (pct) => pct === 0 },
    { id: 'up-3', label: '0~3%', tone: 'up', test: (pct) => pct > 0 && pct < 3 },
    { id: 'up-5', label: '3~5%', tone: 'up', test: (pct) => pct >= 3 && pct < 5 },
    { id: 'up-7', label: '5~7%', tone: 'up', test: (pct) => pct >= 5 && pct < 7 },
    { id: 'up-max', label: '≥7%', tone: 'up', test: (pct) => pct >= 7 && pct < 9.8 },
    { id: 'limit-up', label: '涨停', tone: 'up', test: (pct) => pct >= 9.8 },
  ];
  const buckets = bucketDefs.map((def) => ({
    id: def.id,
    label: def.label,
    tone: def.tone,
    count: list.filter((quote) => def.test(quote.changePct)).length,
  }));
  return {
    upCount: list.filter((quote) => quote.changePct > 0).length,
    downCount: list.filter((quote) => quote.changePct < 0).length,
    flatCount: list.filter((quote) => quote.changePct === 0).length,
    buckets,
  };
}

export interface SectorHeatTile {
  sector: string;
  avgPct: number;
  count: number;
}

export function computeSectorHeat(quotes: Iterable<ResearchQuote>): SectorHeatTile[] {
  const groups = new Map<string, { total: number; count: number }>();
  for (const quote of quotes) {
    const group = groups.get(quote.sector) ?? { total: 0, count: 0 };
    group.total += quote.changePct;
    group.count += 1;
    groups.set(quote.sector, group);
  }
  return Array.from(groups.entries())
    .map(([sector, group]) => ({ sector, avgPct: group.total / group.count, count: group.count }))
    .sort((a, b) => b.avgPct - a.avgPct);
}

// ---- 本地实盘记录状态 -------------------------------------------------------

export interface ResearchHolding {
  code: string;
  quantity: number;
  avgCost: number;
  openedAt: number;
}

export interface ResearchTrade {
  id: string;
  kind: ResearchOrderSide | ResearchCashFlowSide;
  code?: string;
  name?: string;
  price?: number;
  quantity?: number;
  amount: number;
  createdAt: number;
}

export interface ResearchPortfolio {
  id: string;
  name: string;
  codes: string[];
  note: string;
  createdAt: number;
}

export interface CustomSecurity {
  name: string;
  sector?: string;
  basePrice?: number;
}

export interface ResearchState {
  version: 3;
  cash: number;
  /** 净入金（入金 - 出金），用于计算账户总收益 */
  netDeposits: number;
  watchlist: string[];
  holdings: ResearchHolding[];
  portfolios: ResearchPortfolio[];
  trades: ResearchTrade[];
  customSecurities: Record<string, CustomSecurity>;
}

type ResearchStateInput = Partial<Omit<ResearchState, 'version'>> & { version?: number };

export interface ResearchActionResult {
  state: ResearchState;
  error?: string;
}

const RESEARCH_STATE_KEY_V2 = 'alpha-studio.research-state.v2';
const RESEARCH_STATE_KEY_V1 = 'alpha-studio.research-state.v1';
export const RESEARCH_STATE_CHANGE_EVENT = 'alpha-studio:research-state-change';

export function defaultResearchState(): ResearchState {
  const now = Date.now();
  return {
    version: 3,
    cash: 0,
    netDeposits: 0,
    watchlist: ['600519.XSHG', '300750.XSHE', '688981.XSHG', '000001.XSHE', '301308.XSHE'],
    holdings: [],
    portfolios: [
      { id: 'core', name: '核心资产观察', codes: ['600519.XSHG', '000858.XSHE', '600036.XSHG'], note: '消费与金融的估值修复观察组。', createdAt: now },
      { id: 'growth', name: '成长制造组合', codes: ['300750.XSHE', '688981.XSHG', '002594.XSHE'], note: '新能源、半导体和先进制造方向。', createdAt: now },
    ],
    trades: [],
    customSecurities: {},
  };
}

export function loadResearchState(): ResearchState {
  if (typeof window === 'undefined') return defaultResearchState();
  try {
    const rawV2 = window.localStorage.getItem(RESEARCH_STATE_KEY_V2);
    if (rawV2) return normalizeResearchState(JSON.parse(rawV2) as Partial<ResearchState>);
    const rawV1 = window.localStorage.getItem(RESEARCH_STATE_KEY_V1);
    if (rawV1) return migrateV1State(JSON.parse(rawV1) as Record<string, unknown>);
    return defaultResearchState();
  } catch {
    return defaultResearchState();
  }
}

export function saveResearchState(state: ResearchState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESEARCH_STATE_KEY_V2, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(RESEARCH_STATE_CHANGE_EVENT));
}

export function resetResearchState(): ResearchState {
  const next = defaultResearchState();
  saveResearchState(next);
  return next;
}

function migrateV1State(input: Record<string, unknown>): ResearchState {
  const base = defaultResearchState();
  const cash = typeof input.cash === 'number' && Number.isFinite(input.cash) ? input.cash : base.cash;
  const holdings = Array.isArray(input.holdings)
    ? (input.holdings as Array<Record<string, unknown>>)
        .filter((item) => typeof item.code === 'string' && Number(item.quantity) > 0 && Number(item.avgCost) > 0)
        .map((item) => ({
          code: String(item.code),
          quantity: Math.floor(Number(item.quantity)),
          avgCost: Number(item.avgCost),
          openedAt: Date.now(),
        }))
    : base.holdings;
  const holdingsCost = holdings.reduce((sum, item) => sum + item.quantity * item.avgCost, 0);
  return normalizeResearchState({
    version: 1,
    cash,
    netDeposits: cash + holdingsCost,
    watchlist: Array.isArray(input.watchlist) ? (input.watchlist as string[]) : base.watchlist,
    holdings,
    portfolios: Array.isArray(input.portfolios)
      ? (input.portfolios as Array<Record<string, unknown>>)
          .filter((item) => item.id && item.name && Array.isArray(item.codes))
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            codes: (item.codes as string[]).filter((code) => typeof code === 'string'),
            note: typeof item.note === 'string' ? item.note : '',
            createdAt: Date.now(),
          }))
      : base.portfolios,
    trades: Array.isArray(input.trades)
      ? (input.trades as Array<Record<string, unknown>>).map((item) => ({
          id: String(item.id ?? `trade-${Math.random().toString(36).slice(2)}`),
          kind: (item.type ?? item.kind ?? 'buy') as ResearchTrade['kind'],
          code: typeof item.code === 'string' ? item.code : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          price: typeof item.price === 'number' ? item.price : undefined,
          quantity: typeof item.quantity === 'number' ? item.quantity : undefined,
          amount: Number(item.amount) || 0,
          createdAt: Number(item.createdAt) || Date.now(),
        }))
      : [],
    customSecurities: {},
  });
}

export function normalizeResearchState(input: ResearchStateInput): ResearchState {
  const base = defaultResearchState();
  const clearLegacyDemoAccount = isLegacyDemoResearchAccount(input);
  const cash = clearLegacyDemoAccount
    ? 0
    : typeof input.cash === 'number' && Number.isFinite(input.cash) && input.cash >= 0
      ? input.cash
      : base.cash;
  return {
    version: 3,
    cash,
    netDeposits:
      clearLegacyDemoAccount
        ? 0
        : typeof input.netDeposits === 'number' && Number.isFinite(input.netDeposits)
        ? input.netDeposits
        : cash,
    watchlist: Array.isArray(input.watchlist)
      ? Array.from(new Set(input.watchlist.filter((code) => typeof code === 'string' && code)))
      : base.watchlist,
    holdings: clearLegacyDemoAccount
      ? []
      : Array.isArray(input.holdings)
      ? input.holdings
          .filter((item) => item && typeof item.code === 'string' && item.quantity > 0 && item.avgCost > 0)
          .map((item) => ({
            code: item.code,
            quantity: Math.floor(item.quantity),
            avgCost: item.avgCost,
            openedAt: Number(item.openedAt) || Date.now(),
          }))
      : base.holdings,
    portfolios: Array.isArray(input.portfolios)
      ? input.portfolios
          .filter((item) => item && item.id && item.name && Array.isArray(item.codes))
          .map((item) => ({
            id: item.id,
            name: item.name,
            codes: item.codes.filter((code) => typeof code === 'string'),
            note: typeof item.note === 'string' ? item.note : '',
            createdAt: Number(item.createdAt) || Date.now(),
          }))
      : base.portfolios,
    trades: Array.isArray(input.trades) ? input.trades.slice(0, 400) : [],
    customSecurities:
      input.customSecurities && typeof input.customSecurities === 'object'
        ? Object.fromEntries(
            Object.entries(input.customSecurities).filter(
              ([code, value]) => code && value && typeof value.name === 'string',
            ),
          )
        : {},
  };
}

function isLegacyDemoResearchAccount(input: ResearchStateInput): boolean {
  if (input.version !== 2 || input.cash !== 1_000_000 || input.netDeposits !== 1_000_000) return false;
  if (!Array.isArray(input.trades) || input.trades.length !== 0 || !Array.isArray(input.holdings)) return false;
  const expected = new Map([
    ['000001.XSHE', { quantity: 12000, avgCost: 10.96 }],
    ['300750.XSHE', { quantity: 800, avgCost: 198.4 }],
    ['600036.XSHG', { quantity: 5000, avgCost: 34.2 }],
  ]);
  return input.holdings.length === expected.size && input.holdings.every((holding) => {
    const seeded = expected.get(holding.code);
    return seeded?.quantity === holding.quantity && seeded.avgCost === holding.avgCost;
  });
}

type ResearchTradeInput = Omit<ResearchTrade, 'id' | 'createdAt'> & { createdAt?: number };

function createTrade(input: ResearchTradeInput): ResearchTrade {
  return {
    ...input,
    id: `trade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt ?? Date.now(),
  };
}

function addTrade(trades: ResearchTrade[], input: ResearchTradeInput): ResearchTrade[] {
  return [createTrade(input), ...trades].sort((a, b) => b.createdAt - a.createdAt).slice(0, 400);
}

// ---- 账户操作（入金出金 / 买卖 / 自选 / 组合） -------------------------------

export function applyCashFlow(
  state: ResearchState,
  side: ResearchCashFlowSide,
  amount: number,
  createdAt = Date.now(),
): ResearchActionResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { state, error: '请输入大于 0 的金额。' };
  }
  const normalized = Math.round(amount * 100) / 100;
  if (side === 'withdraw' && normalized > state.cash) {
    return { state, error: `可用资金不足，当前现金 ${formatMoney(state.cash)}。` };
  }
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return { state, error: '请输入有效的资金变动时间。' };
  }
  return {
    state: {
      ...state,
      cash: side === 'deposit' ? state.cash + normalized : state.cash - normalized,
      netDeposits: side === 'deposit' ? state.netDeposits + normalized : state.netDeposits - normalized,
      trades: addTrade(state.trades, { kind: side, amount: normalized, createdAt }),
    },
  };
}

export interface ResearchOrderInput {
  side: ResearchOrderSide;
  code: string;
  name: string;
  price: number;
  quantity: number;
  /** 实际成交时间；不传时使用当前时间。 */
  createdAt?: number;
}

export function placeOrder(state: ResearchState, order: ResearchOrderInput): ResearchActionResult {
  const { side, code, name } = order;
  const price = Number(order.price);
  const quantity = Math.floor(Number(order.quantity));
  const createdAt = order.createdAt ?? Date.now();
  if (!code || !name) return { state, error: '请先选择股票。' };
  if (!Number.isFinite(price) || price <= 0) return { state, error: '请输入有效的成交价格。' };
  if (!Number.isFinite(quantity) || quantity <= 0) return { state, error: '请输入有效的成交数量。' };
  if (!Number.isFinite(createdAt) || createdAt <= 0) return { state, error: '请输入有效的成交时间。' };

  if (side === 'buy') {
    if (quantity % 100 !== 0) {
      return { state, error: '买入数量需为 100 股（1 手）的整数倍。' };
    }
    const cost = price * quantity;
    if (cost > state.cash + 1e-6) {
      const maxLots = Math.floor(state.cash / price / 100);
      return {
        state,
        error: `现金不足，按 ${price.toFixed(2)} 最多可买 ${Math.max(0, maxLots) * 100} 股。`,
      };
    }
    const existing = state.holdings.find((item) => item.code === code);
    const holdings = existing
      ? state.holdings.map((item) => {
          if (item.code !== code) return item;
          const nextQuantity = item.quantity + quantity;
          const nextCost = item.quantity * item.avgCost + cost;
          return { ...item, quantity: nextQuantity, avgCost: nextCost / nextQuantity };
        })
      : [...state.holdings, { code, quantity, avgCost: price, openedAt: createdAt }];
    return {
      state: {
        ...state,
        cash: state.cash - cost,
        holdings,
        watchlist: state.watchlist.includes(code) ? state.watchlist : [...state.watchlist, code],
        trades: addTrade(state.trades, { kind: 'buy', code, name, price, quantity, amount: cost, createdAt }),
      },
    };
  }

  const existing = state.holdings.find((item) => item.code === code);
  if (!existing) return { state, error: `当前没有持有 ${name}。` };
  if (quantity > existing.quantity) {
    return { state, error: `可卖数量不足，当前持有 ${existing.quantity} 股。` };
  }
  const proceeds = price * quantity;
  const holdings =
    existing.quantity === quantity
      ? state.holdings.filter((item) => item.code !== code)
      : state.holdings.map((item) =>
          item.code === code ? { ...item, quantity: item.quantity - quantity } : item,
        );
  return {
    state: {
      ...state,
      cash: state.cash + proceeds,
      holdings,
      trades: addTrade(state.trades, { kind: 'sell', code, name, price, quantity, amount: proceeds, createdAt }),
    },
  };
}

/**
 * 清空用户手工录入的实盘账户数据，保留自选、观察组合和自定义证券。
 * 资金与持仓、流水必须一起归零，避免清空后仍展示旧账户余额。
 */
export function clearLiveAccountRecords(state: ResearchState): ResearchState {
  return {
    ...state,
    cash: 0,
    netDeposits: 0,
    holdings: [],
    trades: [],
  };
}

export function toggleWatchlist(state: ResearchState, code: string): ResearchState {
  return {
    ...state,
    watchlist: state.watchlist.includes(code)
      ? state.watchlist.filter((item) => item !== code)
      : [...state.watchlist, code],
  };
}

export function registerCustomSecurity(
  state: ResearchState,
  code: string,
  security: CustomSecurity,
): ResearchState {
  if (!code || !security.name) return state;
  if (RESEARCH_CATALOG.some((entry) => entry.code === code)) return state;
  return {
    ...state,
    customSecurities: { ...state.customSecurities, [code]: security },
  };
}

export function createPortfolio(
  state: ResearchState,
  name: string,
  codes: string[],
  note = '',
): ResearchActionResult {
  const trimmed = name.trim();
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  if (!trimmed) return { state, error: '请输入组合名称。' };
  if (uniqueCodes.length === 0) return { state, error: '请至少选择一只股票。' };
  return {
    state: {
      ...state,
      portfolios: [
        ...state.portfolios,
        {
          id: `portfolio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          name: trimmed,
          codes: uniqueCodes,
          note: note.trim(),
          createdAt: Date.now(),
        },
      ],
    },
  };
}

export function deletePortfolio(state: ResearchState, id: string): ResearchState {
  return { ...state, portfolios: state.portfolios.filter((item) => item.id !== id) };
}

export function updatePortfolio(
  state: ResearchState,
  id: string,
  name: string,
  codes: string[],
  note = '',
): ResearchActionResult {
  const trimmed = name.trim();
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  if (!state.portfolios.some((item) => item.id === id)) return { state, error: '组合不存在或已被删除。' };
  if (!trimmed) return { state, error: '请输入组合名称。' };
  if (uniqueCodes.length === 0) return { state, error: '请至少选择一只股票。' };
  return {
    state: {
      ...state,
      portfolios: state.portfolios.map((item) => (item.id === id
        ? { ...item, name: trimmed, codes: uniqueCodes, note: note.trim() }
        : item)),
    },
  };
}

export function updatePortfolioCodes(state: ResearchState, id: string, codes: string[]): ResearchState {
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  return {
    ...state,
    portfolios: state.portfolios.map((item) => (item.id === id ? { ...item, codes: uniqueCodes } : item)),
  };
}

// ---- 账户汇总 ---------------------------------------------------------------

export interface ResearchHoldingRow extends ResearchHolding {
  quote: ResearchQuote;
  marketValue: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  /** 按最新价相对昨收估算的当日浮动盈亏 */
  todayPnl: number;
  todayPnlPct: number;
  /** 占总资产比例（%） */
  weightPct: number;
}

export interface ResearchAccountSummary {
  holdings: ResearchHoldingRow[];
  marketValue: number;
  cost: number;
  pnl: number;
  totalAssets: number;
  totalReturn: number;
  totalReturnPct: number;
  exposurePct: number;
  concentrationPct: number;
}

export function researchAccountSummary(
  state: ResearchState,
  quotes: Map<string, ResearchQuote>,
): ResearchAccountSummary {
  const rows: ResearchHoldingRow[] = [];
  for (const holding of state.holdings) {
    const quote = quotes.get(holding.code);
    if (!quote) continue;
    const marketValue = holding.quantity * quote.price;
    const cost = holding.quantity * holding.avgCost;
    const pnl = marketValue - cost;
    const todayPnl = holding.quantity * (quote.price - quote.prevClose);
    rows.push({
      ...holding,
      quote,
      marketValue,
      cost,
      pnl,
      pnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
      todayPnl,
      todayPnlPct: quote.prevClose > 0 ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : 0,
      weightPct: 0,
    });
  }
  const marketValue = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const pnl = marketValue - cost;
  const totalAssets = state.cash + marketValue;
  for (const row of rows) {
    row.weightPct = totalAssets > 0 ? (row.marketValue / totalAssets) * 100 : 0;
  }
  rows.sort((a, b) => b.marketValue - a.marketValue);
  const totalReturn = totalAssets - state.netDeposits;
  return {
    holdings: rows,
    marketValue,
    cost,
    pnl,
    totalAssets,
    totalReturn,
    totalReturnPct: state.netDeposits > 0 ? (totalReturn / state.netDeposits) * 100 : 0,
    exposurePct: totalAssets > 0 ? (marketValue / totalAssets) * 100 : 0,
    concentrationPct:
      totalAssets > 0 && rows.length
        ? (Math.max(...rows.map((row) => row.marketValue)) / totalAssets) * 100
        : 0,
  };
}

export interface SectorExposureRow {
  sector: string;
  value: number;
  pct: number;
}

export function sectorExposure(summary: ResearchAccountSummary): SectorExposureRow[] {
  const total = summary.marketValue || 1;
  const groups = new Map<string, number>();
  for (const row of summary.holdings) {
    groups.set(row.quote.sector, (groups.get(row.quote.sector) ?? 0) + row.marketValue);
  }
  return Array.from(groups.entries())
    .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
}

// ---- 格式化 ------------------------------------------------------------------

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMoney(value)}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function shortCode(code: string): string {
  return code.split('.')[0] ?? code;
}

export function changeTone(value: number): 'up' | 'down' | 'flat' {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

// ---- 拖拽到对话框的 prompt ---------------------------------------------------

export function securityPrompt(quote: ResearchQuote): string {
  const lines = [
    `请分析股票 ${quote.name}（${quote.code}）。`,
    `当前价 ${quote.price.toFixed(2)}，涨跌幅 ${formatPercent(quote.changePct)}，行业 ${quote.sector}，${quote.board}。`,
  ];
  if (quote.turnoverAmount || quote.volumeShares) {
    lines.push(
      `成交额 ${quote.turnoverAmount ? formatMoney(quote.turnoverAmount) : formatMoney(quote.turnover * 100000000)}，成交量 ${
        quote.volumeShares ? formatMoney(quote.volumeShares) : `${quote.volume.toFixed(2)}万手`
      }。`,
    );
  }
  if (quote.highLimit || quote.lowLimit || quote.paused) {
    lines.push(
      `交易状态：${quote.paused ? '停牌/无成交' : '正常交易'}${
        quote.highLimit ? `，涨停价 ${quote.highLimit.toFixed(2)}` : ''
      }${quote.lowLimit ? `，跌停价 ${quote.lowLimit.toFixed(2)}` : ''}。`,
    );
  }
  if (quote.tags.length) lines.push(`标签：${quote.tags.join('、')}。`);
  if (quote.thesis) lines.push(`初始观察：${quote.thesis}`);
  if (quote.source === 'eastmoney') {
    lines.push('价格由云端行情服务从东方财富主源归一化后推送。请结合我的持仓与风险偏好，给出可验证的投研结论、关键风险和下一步需要补充的数据。');
  } else if (quote.source === 'tencent') {
    lines.push('价格由云端行情服务从腾讯备源归一化后推送，部分板块或估值字段可能缺失。请结合我的持仓与风险偏好，给出可验证的投研结论、关键风险和下一步需要补充的数据。');
  } else if (quote.source === 'jqdata') {
    lines.push('价格来自聚宽（JQData）日线快照。请结合我的持仓与风险偏好，给出可验证的投研结论、关键风险和下一步需要补充的数据。');
  } else {
    lines.push('价格为本地样例快照，如需精确数据请调用真实行情源。请给出可验证的投研结论、关键风险和下一步需要补充的数据。');
  }
  return lines.join('\n');
}

export function holdingPrompt(row: ResearchHoldingRow): string {
  return [
    `请复盘我记录的实盘持仓：${row.quote.name}（${row.code}）。`,
    `持仓 ${row.quantity} 股，成本 ${row.avgCost.toFixed(2)}，现价 ${row.quote.price.toFixed(2)}，浮盈亏 ${formatSignedMoney(row.pnl)}（${formatPercent(row.pnlPct)}），占总资产 ${formatPercent(row.weightPct)}。`,
    '请判断仓位是否合理、止盈止损位如何设置，以及是否需要与组合内其它标的做对冲或替换。',
  ].join('\n');
}

export function portfolioPrompt(
  portfolio: ResearchPortfolio,
  quotes: Map<string, ResearchQuote>,
): string {
  const lines = portfolio.codes.map((code) => {
    const quote = quotes.get(code);
    if (!quote) return `- ${code}`;
    return `- ${quote.name}（${code}）：${quote.sector}，现价 ${quote.price.toFixed(2)}，${formatPercent(quote.changePct)}`;
  });
  return [
    `请分析股票组合「${portfolio.name}」。`,
    portfolio.note || '（组合暂无备注）',
    '组合成分：',
    ...lines,
    '请输出组合主线、行业暴露、潜在共振催化、最大风险源和可执行的跟踪清单。',
  ].join('\n');
}

export function accountPrompt(state: ResearchState, summary: ResearchAccountSummary): string {
  const holdingLines = summary.holdings.map((row) => (
    `- ${row.quote.name}（${row.code}）：${row.quantity} 股，成本 ${row.avgCost.toFixed(2)}，现价 ${row.quote.price.toFixed(2)}，` +
    `市值 ${formatMoney(row.marketValue)}，浮盈亏 ${formatSignedMoney(row.pnl)}（${formatPercent(row.pnlPct)}），` +
    `今日盈亏 ${formatSignedMoney(row.todayPnl)}（${formatPercent(row.todayPnlPct)}），占总资产 ${formatPercent(row.weightPct)}。`
  ));
  return [
    '请基于我手工记录的实盘账户做一次投研和交易复盘。',
    `总资产 ${formatMoney(summary.totalAssets)}，现金 ${formatMoney(state.cash)}，持仓市值 ${formatMoney(summary.marketValue)}，浮盈亏 ${formatSignedMoney(summary.pnl)}，累计收益 ${formatSignedMoney(summary.totalReturn)}（${formatPercent(summary.totalReturnPct)}），仓位 ${formatPercent(summary.exposurePct)}。`,
    '当前持仓明细：',
    ...(holdingLines.length ? holdingLines : ['- 暂无持仓。']),
    '请输出仓位建议、风险来源、可执行观察清单和需要补充的 JQData 数据字段。',
  ].join('\n');
}

export function watchlistPrompt(quotes: ResearchQuote[]): string {
  const lines = quotes.map(
    (quote) => `- ${quote.name}（${quote.code}）：${quote.sector}，现价 ${quote.price.toFixed(2)}，${formatPercent(quote.changePct)}`,
  );
  return [
    '请帮我梳理自选股清单，指出今天值得优先跟踪的标的和理由。',
    '自选股：',
    ...(lines.length ? lines : ['- （自选股为空）']),
    '请按优先级排序，并给出每只标的的观察触发条件。',
  ].join('\n');
}

export function marketSnapshotPrompt(input: {
  title: string;
  quotes: ResearchQuote[];
  overview: MarketOverview;
  sourceLabel: string;
  asOfLabel?: string | null;
  note?: string | null;
}): string {
  const total = input.quotes.length;
  const totalTurnover = input.quotes.reduce((sum, quote) => sum + quote.turnover * 100000000, 0);
  const turnoverLeaders = [...input.quotes]
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 6)
    .map((quote) => `${quote.name} ${formatMoney(quote.turnover * 100000000)} ${formatPercent(quote.changePct)}`);
  const movers = [...input.quotes]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6)
    .map((quote) => `${quote.name} ${formatPercent(quote.changePct)}（${quote.sector}）`);
  const heat = computeSectorHeat(input.quotes).slice(0, 5);
  return [
    `请基于「${input.title}」做一次全市场投研解读。`,
    `数据口径：${input.sourceLabel}${input.asOfLabel ? `，${input.asOfLabel}` : ''}，样本 ${total} 只。`,
    `涨跌家数：上涨 ${input.overview.upCount}、下跌 ${input.overview.downCount}、平盘 ${input.overview.flatCount}；成交额合计 ${formatMoney(totalTurnover)}。`,
    `强势行业：${heat.map((tile) => `${tile.sector} ${formatPercent(tile.avgPct)}（${tile.count}只）`).join('；') || '暂无' }。`,
    `成交额 Top：${turnoverLeaders.join('；') || '暂无'}。`,
    `异动标的：${movers.join('；') || '暂无'}。`,
    input.note ? `数据提示：${input.note}` : '',
    '请判断市场风险偏好、主线扩散/收敛、对我的持仓仓位的影响，以及下一步需要调用的 JQData 字段。',
  ].filter(Boolean).join('\n');
}

export function rankListPrompt(title: string, rows: ResearchQuote[], metric: 'turnover' | 'change'): string {
  const lines = rows.map((quote, index) => {
    const value =
      metric === 'turnover'
        ? formatMoney(quote.turnover * 100000000)
        : formatPercent(quote.changePct);
    return `${index + 1}. ${quote.name}（${quote.code}）：${quote.sector}，${value}，涨跌幅 ${formatPercent(quote.changePct)}`;
  });
  return [
    `请解读「${title}」榜单。`,
    ...(lines.length ? lines : ['暂无榜单数据。']),
    '请识别是否存在同一行业/主题的共振，判断哪些标的值得继续深挖，并列出需要补充验证的数据。',
  ].join('\n');
}

export function sectorHeatPrompt(tile: SectorHeatTile, quotes: ResearchQuote[]): string {
  const leaders = quotes
    .filter((quote) => quote.sector === tile.sector)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 8)
    .map((quote) => `- ${quote.name}（${quote.code}）：${formatPercent(quote.changePct)}，成交额 ${formatMoney(quote.turnover * 100000000)}`);
  return [
    `请分析行业「${tile.sector}」的热力变化。`,
    `行业平均涨跌幅 ${formatPercent(tile.avgPct)}，样本 ${tile.count} 只。`,
    '代表标的：',
    ...(leaders.length ? leaders : ['- 暂无可用成分。']),
    '请判断这是主线强化、补涨轮动还是风险释放，并给出可跟踪的催化、证伪信号和需要补充的聚宽数据。',
  ].join('\n');
}

export function distributionPrompt(overview: MarketOverview, scopeLabel: string): string {
  const buckets = overview.buckets.map((bucket) => `${bucket.label}：${bucket.count}`).join('；');
  return [
    `请解读${scopeLabel}的涨跌分布。`,
    `上涨 ${overview.upCount}、下跌 ${overview.downCount}、平盘 ${overview.flatCount}。`,
    `分布桶：${buckets}。`,
    '请判断市场宽度、亏钱效应、情绪极端位置，以及是否适合提高/降低仓位。',
  ].join('\n');
}

export function sectorExposurePrompt(rows: SectorExposureRow[]): string {
  const lines = rows.map((row) => `- ${row.sector}：${formatMoney(row.value)}，占持仓 ${formatPercent(row.pct)}`);
  return [
    '请分析我的持仓行业暴露。',
    ...(lines.length ? lines : ['- 暂无行业暴露。']),
    '请指出集中度风险、相关性风险、需要对冲或替换的方向，以及每个行业下一步应补充的 JQData 数据。',
  ].join('\n');
}

export function tradePrompt(trade: ResearchTrade): string {
  const time = new Date(trade.createdAt).toLocaleString('zh-CN', { hour12: false });
  if (trade.kind === 'deposit' || trade.kind === 'withdraw') {
    return [
      `请复盘这笔${trade.kind === 'deposit' ? '入金' : '出金'}流水。`,
      `时间 ${time}，金额 ${formatMoney(trade.amount)}。`,
      '请判断这笔资金变动对仓位、现金管理和后续交易计划的影响。',
    ].join('\n');
  }
  return [
    `请复盘这笔实盘${trade.kind === 'buy' ? '买入' : '卖出'}记录。`,
    `标的 ${trade.name ?? trade.code ?? '未知'}（${trade.code ?? '无代码'}），数量 ${trade.quantity ?? 0} 股，价格 ${trade.price?.toFixed(2) ?? '-'}，成交金额 ${formatMoney(trade.amount)}，时间 ${time}。`,
    '请判断交易动机是否成立、执行价格是否合理、后续止盈止损和仓位调整怎么做。',
  ].join('\n');
}

export function tradeLogPrompt(trades: ResearchTrade[]): string {
  const lines = trades.slice(0, 12).map((trade, index) => {
    if (trade.kind === 'deposit' || trade.kind === 'withdraw') {
      return `${index + 1}. ${TRADE_KIND_COPY[trade.kind]} ${formatMoney(trade.amount)}`;
    }
    return `${index + 1}. ${TRADE_KIND_COPY[trade.kind]} ${trade.name ?? trade.code ?? ''} ${trade.quantity ?? 0}股 @ ${trade.price?.toFixed(2) ?? '-'}，${formatMoney(trade.amount)}`;
  });
  return [
    '请复盘我的实盘交易记录与资金流水。',
    ...(lines.length ? lines : ['暂无交易流水。']),
    '请识别交易纪律、追涨杀跌、仓位节奏、胜率/赔率问题，并给出下一步改进清单。',
  ].join('\n');
}

const TRADE_KIND_COPY: Record<ResearchTrade['kind'], string> = {
  buy: '买入',
  sell: '卖出',
  deposit: '入金',
  withdraw: '出金',
};

export interface ResearchAnalysisTask {
  id: string;
  title: string;
  prompt: string;
}

export const RESEARCH_ANALYSIS_TASKS: ResearchAnalysisTask[] = [
  { id: 'position-risk', title: '持仓体检', prompt: '请对我记录的实盘持仓做一次风险体检，重点看集中度、行业暴露、浮盈亏结构和止损止盈安排。' },
  { id: 'portfolio-compare', title: '组合比较', prompt: '请比较我的股票组合，判断哪个组合的主线更清晰、风险收益比更好，并列出需要补充验证的数据。' },
  { id: 'trade-plan', title: '交易计划', prompt: '请基于当前实盘记录、持仓和自选股，给出一份只读交易计划：观察位、买卖触发条件、仓位上限和证伪信号。' },
  { id: 'jq-fundamental-gap', title: '财务缺口', prompt: '请优先补齐聚宽财务基本面数据：估值、利润表、资产负债表、现金流和连续财务指标，判断当前结论有哪些盲区。' },
  { id: 'jq-factor-risk', title: '因子风控', prompt: '请用聚宽因子/风险模型视角检查我的组合，重点看风格暴露、行业暴露、拥挤度、回撤风险和需要降低的共性因子。' },
];
