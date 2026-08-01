# 腾讯财经 A 股资金流能力核验

核验时间：2026-08-01（周六，接口返回最近交易日 2026-07-31 的数据）。

## 结论

腾讯当前网页端**确实有服务端直接返回的四档资金净流字段**，不是必须由调用方用成交明细自行估算。真正值得接入的是腾讯股票详情页当前使用的 `hsfundtab` 网页内部接口，而不是旧的 `ff_` 接口：

```text
https://proxy.finance.qq.com/cgi/cgi-bin/fundflow/hsfundtab
  ?code=sz000001
  &type=historyFundFlow,fiveDayFundFlow,todayFundTrend,todayFundFlow
  &klineNeedDay=20
```

2026-08-01 实测该地址返回 `code: 0`、`msg: ok`。它可支撑：

- 当日主力总流入、主力总流出和主力净流入；散户总流入、总流出及净流入；
- 超大单、大单、中单、小单四档的**净流入**；
- 从 09:30 到 15:00 的分钟累计资金趋势，包含四档净流与主力流入/流出；
- 近 5 日主力净流入，以及可由 `klineNeedDay` 请求的日级主力净流入历史。

但它**不能原样复刻截图中的八段资金分布**。当前响应仅给出 `superFlow`、`bigFlow`、`normalFlow`、`smallFlow` 四档净值，没有分别给出“超大/大/中/小单各自流入额和流出额”。所以可以画四档净流柱/折线、主力与散户的流入流出分布；不能可靠拆成四档各自的流入/流出双边圆环。若强行从净值反推双边额，结果不唯一，应明确禁止。

## 字段与口径

### `todayFundFlow`

实测关键字段：

| 字段 | 含义 |
|---|---|
| `mainIn` / `mainOut` / `mainNetIn` | 主力流入、流出、净流入，单位为元 |
| `retailIn` / `retailOut` | 散户流入、流出，单位为元 |
| `mainInRate` / `mainOutRate` / `retailInRate` / `retailOutRate` | 四块占比，可直接用于主力/散户双边分布 |
| `superFlow` | 超大单净流入 |
| `bigFlow` | 大单净流入 |
| `normalFlow` | 中单净流入 |
| `smallFlow` | 小单净流入 |

响应自带的腾讯口径说明为：逐笔统计当日成交买卖单；主力等于超大单加大单；成交金额大于等于 20 万元，或者成交量大于等于 6 万股，判为主力资金。需要注意，这只明确了“主力”合计门槛，响应没有给出超大/大/中/小四档全部分界值。

### `todayFundTrend`

`minList` 实测为 242 个分钟点，字段包括：

- `time`、`Price`；
- `MainNetInflow`、`RetailNetInflow`；
- `SuperNetInflow`、`BigNetInflow`、`NormalNetInflow`、`SmallNetInflow`；
- `MainInflow`、`MainOutflow`。

这些是日内累计值，适合画“分时资金流向”，前端应按 `time` 排序。周末请求返回最近交易日数据，而不是空数组。

### 日级历史

- `fiveDayFundFlow.DayMainNetInList`：最近 5 个交易日的 `date`、`mainNetIn`。
- `historyFundFlow.oneDayKlineList`：实测在 `klineNeedDay=20` 时返回 20 个交易日，含 `date`、`mainNetIn`、`price`、`avgIn`。

当前接口没有直接提供周/月周期序列；周/月应由日级 `mainNetIn` 在本地聚合，并保留“腾讯主力口径”标签。接口是否允许任意加大 `klineNeedDay` 未见公开保证，接入时应设置分页/长度上限和降级策略。

## 普通行情、逐笔成交与真正资金流的区别

1. **普通行情**：`https://qt.gtimg.cn/q=sz000001` 返回最新价、昨收、成交量/额、内外盘、五档盘口等。它不是四档资金流接口；末尾扩展字段缺少可靠的公开字段契约，不应猜下标作为资金流依据。
2. **成交明细**：`https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=sz000001&p=0` 返回时间、成交价、成交量/额与 `B/S/M` 主买/主卖/中性标记。调用方可以据此做近似统计，但分页数据是约 3 秒粒度的成交明细，不等同于可还原原始委托单的完整 Level-2 数据，也不能可靠识别“主力是谁”。
3. **盘口分析**：`https://qt.gtimg.cn/q=s_pksz000001` 当前仍返回四个比例。历史字段解释为买盘大单、买盘小单、卖盘大单、卖盘小单；它只有“大/小”二分比例，不是超大/大/中/小四档金额。
4. **真正资金流派生字段**：`hsfundtab` 直接返回由腾讯服务端统计好的主力/散户及四档净流，是本项目应优先采用的腾讯来源。

## 旧 `ff_` 接口状态

旧资料记录的地址 `https://qt.gtimg.cn/q=ff_sz000001` 曾返回主力/散户流入、流出、净流入及少量历史值，但它也不是四档资金数据。2026-08-01 对 `ff_sz000001`、`ff_sh600519`、`ff_sz002594`、`ff_sh600000` 实测均只返回：

```text
v_pv_none_match="1";
```

因此旧 `ff_` 端点应判为已失效/不可依赖，不能作为生产数据源。腾讯现行股票详情页的 JavaScript 仍保留旧调用代码，但同时使用新的 `hsfundtab` 接口；实际数据应以后者为准。

## 更新时间、稳定性与接入风险

- 分钟数据实测覆盖 09:30 至 15:00，说明接口具备盘中分钟级展示能力；具体延迟秒数、刷新频率和节假日行为没有公开 SLA，应以服务端返回的最后 `time` 为准，并在 UI 显示“截至 HH:mm”。
- 官方页面脚本明确调用 `hsfundtab`，且当前无需登录即可取得 JSON，因此技术上可免费读取；但这是**未公开文档化的网页内部端点**，没有版本、字段稳定性、调用配额或长期可用承诺。
- `proxy.finance.qq.com` 响应头仅表现为按 `Origin` 变化，未像 `qt.gtimg.cn` 那样明确返回通配 CORS；纯浏览器直连可能受跨域限制。更稳妥的架构是由本项目后端/桌面端代理请求，并做超时、缓存、限频和 schema 校验。
- 未找到腾讯面向第三方发布的免费金融数据 API 授权条款。免费可访问不等于允许批量抓取、再分发或商业使用；正式发布前应核对腾讯网站条款/取得许可，不能把该网页端点描述成“腾讯开放 API”。
- “主力”是按成交金额/股数规则计算的统计标签，不等于已识别到某家机构、庄家或同一资金账户；AI 只能表述为资金行为证据，不能承诺“主力在就放心持有”。

## 对项目的建议

建议把腾讯作为免费的第二数据源，能力标签写清楚：

```text
腾讯 hsfundtab
├── 当日主力/散户流入流出：可用
├── 四档净流入：可用
├── 分钟四档净流趋势：可用
├── 日级主力净流历史：可用（长度需实测/限流）
└── 四档各自流入与流出：不可用
```

若产品必须与截图完全一致，四档流入/流出八个数仍应寻找东方财富等直接返回双边四档金额的数据源；腾讯可作为趋势及主力净流的降级/交叉验证来源。

## 来源

1. 腾讯股票详情页（官方页面）：https://gu.qq.com/sz000001/gp
2. 腾讯页面当前加载的官方 JavaScript bundle；源码中定义并调用 `hsfundtab?code=...&type=historyFundFlow,fiveDayFundFlow,todayFundTrend,todayFundFlow&klineNeedDay=20`：https://st.gtimg.com/quotes/hs-fund/bundle.b2461612.js
3. 腾讯当前资金流 JSON 端点（官方域名、实测有效）：https://proxy.finance.qq.com/cgi/cgi-bin/fundflow/hsfundtab?code=sz000001&type=historyFundFlow%2CfiveDayFundFlow%2CtodayFundTrend%2CtodayFundFlow&klineNeedDay=20
4. 腾讯普通行情端点（官方域名）：https://qt.gtimg.cn/q=sz000001
5. 腾讯逐笔成交端点（官方域名）：https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=sz000001&p=0
6. 旧腾讯资金流接口字段整理（第三方资料，用于历史对照，不作为当前可用性证明）：https://www.cnblogs.com/shclbear/p/16678012.html
7. 旧接口含少量历史数据的示例（第三方资料）：https://www.cnblogs.com/yaoyangding/p/18677261
