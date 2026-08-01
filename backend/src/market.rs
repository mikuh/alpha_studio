use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{broadcast, Mutex, RwLock};

const MARKET_CACHE_KEY: &str = "alpha:market:a-share:snapshot:v2";
const EASTMONEY_FIELDS: &str =
    "f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18,f20,f21,f23,f8,f10,f100,f292";
const EASTMONEY_A_SHARE_FILTER: &str = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
// Eastmoney's own quote-center ETF page currently uses these five boards for
// Shanghai/Shenzhen listed ETFs.
const EASTMONEY_A_SHARE_ETF_FILTER: &str = "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827";
const INDEX_CODES: &[&str] = &[
    "1.000001", "0.399001", "0.399006", "1.000300", "1.000688", "1.000016",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketQuote {
    pub code: String,
    pub raw_code: String,
    pub name: String,
    pub market: String,
    pub board: String,
    pub sector: String,
    pub security_type: String,
    pub source: String,
    pub price: f64,
    pub prev_close: f64,
    pub change_pct: f64,
    pub change_amt: f64,
    pub open: Option<f64>,
    pub high: Option<f64>,
    pub low: Option<f64>,
    pub volume_shares: Option<f64>,
    pub turnover_amount: Option<f64>,
    pub market_cap_amount: Option<f64>,
    pub float_market_cap_amount: Option<f64>,
    pub turnover_rate: Option<f64>,
    pub volume_ratio: Option<f64>,
    pub pb: Option<f64>,
    pub status: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    pub schema_version: u32,
    pub sequence: u64,
    pub market: String,
    pub source: String,
    pub as_of: String,
    pub generated_at: String,
    pub stale: bool,
    pub quotes: Vec<MarketQuote>,
    pub warnings: Vec<String>,
}

#[derive(Clone)]
pub struct MarketDataHub {
    inner: Arc<MarketDataHubInner>,
}

struct MarketDataHubInner {
    current: RwLock<Option<Arc<MarketSnapshot>>>,
    refresh_gate: Mutex<()>,
    sender: broadcast::Sender<Arc<MarketSnapshot>>,
    sequence: AtomicU64,
    refresh_seconds: u64,
    snapshot_limit: usize,
}

impl MarketDataHub {
    pub fn new(refresh_seconds: u64, snapshot_limit: usize) -> Self {
        let (sender, _) = broadcast::channel(32);
        Self {
            inner: Arc::new(MarketDataHubInner {
                current: RwLock::new(None),
                refresh_gate: Mutex::new(()),
                sender,
                sequence: AtomicU64::new(0),
                refresh_seconds: refresh_seconds.clamp(15, 300),
                snapshot_limit: snapshot_limit.clamp(100, 8000),
            }),
        }
    }

    pub fn refresh_seconds(&self) -> u64 {
        self.inner.refresh_seconds
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<MarketSnapshot>> {
        self.inner.sender.subscribe()
    }

    pub async fn current(&self) -> Option<Arc<MarketSnapshot>> {
        self.inner.current.read().await.clone()
    }

    pub async fn ensure_snapshot(
        &self,
        http: &Client,
        redis: Option<&redis::Client>,
    ) -> Result<Arc<MarketSnapshot>, String> {
        if let Some(current) = self.current().await {
            if snapshot_age_seconds(&current) < self.inner.refresh_seconds {
                return Ok(current);
            }
        }
        self.refresh(http, redis).await
    }

    pub async fn refresh(
        &self,
        http: &Client,
        redis: Option<&redis::Client>,
    ) -> Result<Arc<MarketSnapshot>, String> {
        let _guard = self.inner.refresh_gate.lock().await;
        if let Some(current) = self.current().await {
            if snapshot_age_seconds(&current) < self.inner.refresh_seconds.saturating_sub(2) {
                return Ok(current);
            }
        }

        let mut warnings = Vec::new();
        let provider_result = match fetch_eastmoney_snapshot(http, self.inner.snapshot_limit).await
        {
            Ok((quotes, provider_warnings)) if !quotes.is_empty() => {
                warnings.extend(provider_warnings);
                Ok(("eastmoney".to_string(), quotes))
            }
            Ok(_) => {
                warnings.push("东方财富主源返回空行情，已切换腾讯备源。".to_string());
                fetch_tencent_snapshot(http, self.inner.snapshot_limit)
                    .await
                    .map(|quotes| ("tencent".to_string(), quotes))
            }
            Err(error) => {
                warnings.push(format!("东方财富主源失败：{error}"));
                fetch_tencent_snapshot(http, self.inner.snapshot_limit)
                    .await
                    .map(|quotes| ("tencent".to_string(), quotes))
            }
        };

        match provider_result {
            Ok((source, quotes)) if !quotes.is_empty() => {
                if source == "tencent" {
                    warnings
                        .push("当前使用腾讯备源，部分板块、OHLC 与估值字段可能缺失。".to_string());
                }
                let now = Utc::now().to_rfc3339();
                let snapshot = Arc::new(MarketSnapshot {
                    schema_version: 1,
                    sequence: self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1,
                    market: "a-share".to_string(),
                    source,
                    as_of: now.clone(),
                    generated_at: now,
                    stale: false,
                    quotes,
                    warnings,
                });
                self.publish(snapshot.clone(), redis).await;
                Ok(snapshot)
            }
            Ok(_) => {
                warnings.push("东方财富与腾讯行情源均返回空行情。".to_string());
                if let Some(cached) = self.current().await {
                    return Ok(stale_snapshot(&cached, warnings));
                }
                if let Some(cached) = load_redis_snapshot(redis).await {
                    self.inner
                        .sequence
                        .fetch_max(cached.sequence, Ordering::Relaxed);
                    let stale = stale_snapshot(&Arc::new(cached), warnings);
                    *self.inner.current.write().await = Some(stale.clone());
                    return Ok(stale);
                }
                Err("东方财富与腾讯行情源均不可用，且没有云端缓存。".to_string())
            }
            Err(error) => {
                warnings.push(format!("腾讯备源失败：{error}"));
                if let Some(cached) = self.current().await {
                    return Ok(stale_snapshot(&cached, warnings));
                }
                if let Some(cached) = load_redis_snapshot(redis).await {
                    self.inner
                        .sequence
                        .fetch_max(cached.sequence, Ordering::Relaxed);
                    let stale = stale_snapshot(&Arc::new(cached), warnings);
                    *self.inner.current.write().await = Some(stale.clone());
                    return Ok(stale);
                }
                Err("东方财富与腾讯行情源均不可用，且没有云端缓存。".to_string())
            }
        }
    }

    async fn publish(&self, snapshot: Arc<MarketSnapshot>, redis: Option<&redis::Client>) {
        *self.inner.current.write().await = Some(snapshot.clone());
        let _ = self.inner.sender.send(snapshot.clone());
        if let (Some(client), Ok(payload)) = (redis, serde_json::to_string(snapshot.as_ref())) {
            if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                let ttl = (self.inner.refresh_seconds * 8).clamp(120, 3600);
                let _: Result<(), _> = connection.set_ex(MARKET_CACHE_KEY, payload, ttl).await;
            }
        }
    }
}

fn snapshot_age_seconds(snapshot: &MarketSnapshot) -> u64 {
    DateTime::parse_from_rfc3339(&snapshot.generated_at)
        .ok()
        .map(|time| {
            Utc::now()
                .signed_duration_since(time.with_timezone(&Utc))
                .num_seconds()
                .max(0) as u64
        })
        .unwrap_or(u64::MAX)
}

fn stale_snapshot(
    snapshot: &Arc<MarketSnapshot>,
    mut warnings: Vec<String>,
) -> Arc<MarketSnapshot> {
    warnings.extend(snapshot.warnings.clone());
    warnings.push("上游刷新失败，当前为最近一次云端缓存。".to_string());
    Arc::new(MarketSnapshot {
        stale: true,
        warnings,
        ..snapshot.as_ref().clone()
    })
}

async fn load_redis_snapshot(redis: Option<&redis::Client>) -> Option<MarketSnapshot> {
    let client = redis?;
    let mut connection = client.get_multiplexed_async_connection().await.ok()?;
    let payload: String = connection.get(MARKET_CACHE_KEY).await.ok()?;
    serde_json::from_str(&payload).ok()
}

async fn fetch_eastmoney_snapshot(
    client: &Client,
    limit: usize,
) -> Result<(Vec<MarketQuote>, Vec<String>), String> {
    let mut warnings = Vec::new();
    let mut quotes =
        fetch_eastmoney_collection(client, EASTMONEY_A_SHARE_FILTER, limit, "stock").await?;
    let remaining = limit.saturating_sub(quotes.len());
    if remaining > 0 {
        match fetch_eastmoney_collection(client, EASTMONEY_A_SHARE_ETF_FILTER, remaining, "etf")
            .await
        {
            Ok(etfs) => quotes.extend(etfs),
            Err(error) => warnings.push(format!("A股 ETF 行情读取失败：{error}")),
        }
    } else {
        warnings.push(
            "行情快照容量已满，未能加入 A 股 ETF；请提高 MARKET_SNAPSHOT_LIMIT。".to_string(),
        );
    }
    if let Ok(indexes) = fetch_eastmoney_indexes(client).await {
        quotes.extend(indexes);
    }
    Ok((dedupe_quotes(quotes, limit + INDEX_CODES.len())?, warnings))
}

async fn fetch_eastmoney_collection(
    client: &Client,
    filter: &str,
    limit: usize,
    security_type: &str,
) -> Result<Vec<MarketQuote>, String> {
    let page_size = 100usize;
    let first = fetch_eastmoney_page(client, 1, page_size, filter).await?;
    let total = first
        .pointer("/data/total")
        .and_then(Value::as_u64)
        .unwrap_or(limit as u64) as usize;
    let requested = total.min(limit);
    let pages = requested.div_ceil(page_size).max(1);
    let mut quotes = eastmoney_rows(&first, security_type)?;
    for page in 2..=pages {
        let value = fetch_eastmoney_page(client, page, page_size, filter).await?;
        let rows = eastmoney_rows(&value, security_type)?;
        if rows.is_empty() {
            break;
        }
        quotes.extend(rows);
    }
    dedupe_quotes(quotes, limit)
}

async fn fetch_eastmoney_page(
    client: &Client,
    page: usize,
    page_size: usize,
    filter: &str,
) -> Result<Value, String> {
    let url = "https://push2delay.eastmoney.com/api/qt/clist/get";
    let response = client
        .get(url)
        .query(&[
            ("pn", page.to_string()),
            ("pz", page_size.to_string()),
            ("po", "1".to_string()),
            ("np", "1".to_string()),
            ("fltt", "2".to_string()),
            ("invt", "2".to_string()),
            ("fid", "f3".to_string()),
            ("fs", filter.to_string()),
            ("fields", EASTMONEY_FIELDS.to_string()),
        ])
        .header("Referer", "https://quote.eastmoney.com/")
        .header("User-Agent", "Mozilla/5.0 AlphaStudioMarket/1.0")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())
}

async fn fetch_eastmoney_indexes(client: &Client) -> Result<Vec<MarketQuote>, String> {
    let url = "https://push2delay.eastmoney.com/api/qt/ulist.np/get";
    let secids = INDEX_CODES.join(",");
    let response = client
        .get(url)
        .query(&[
            ("fltt", "2"),
            ("invt", "2"),
            ("fields", EASTMONEY_FIELDS),
            ("secids", secids.as_str()),
        ])
        .header("Referer", "https://quote.eastmoney.com/")
        .header("User-Agent", "Mozilla/5.0 AlphaStudioMarket/1.0")
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    eastmoney_rows(&value, "index")
}

fn eastmoney_rows(value: &Value, security_type: &str) -> Result<Vec<MarketQuote>, String> {
    let rows = value
        .pointer("/data/diff")
        .and_then(Value::as_array)
        .ok_or_else(|| "missing data.diff".to_string())?;
    Ok(rows
        .iter()
        .filter_map(|row| parse_eastmoney_quote_as(row, security_type))
        .collect())
}

fn parse_eastmoney_quote_as(row: &Value, security_type: &str) -> Option<MarketQuote> {
    let raw_code = value_string(row, "f12")?;
    let market_id = value_i64(row, "f13").unwrap_or(0);
    let market = if market_id == 1 { "SH" } else { "SZ" };
    let code = format!(
        "{raw_code}.{}",
        if market_id == 1 { "XSHG" } else { "XSHE" }
    );
    let raw_price = value_f64(row, "f2");
    let prev_close = value_f64(row, "f18").or(raw_price)?;
    let price = raw_price.unwrap_or(prev_close);
    if price <= 0.0 {
        return None;
    }
    let change_amt = value_f64(row, "f4").unwrap_or(price - prev_close);
    let change_pct = value_f64(row, "f3").unwrap_or_else(|| {
        if prev_close > 0.0 {
            change_amt / prev_close * 100.0
        } else {
            0.0
        }
    });
    let name = value_string(row, "f14").unwrap_or(raw_code.clone());
    let board = match security_type {
        "etf" => format!("{}市ETF", if market_id == 1 { "沪" } else { "深" }),
        "index" => "主要指数".to_string(),
        _ => board_from_code(&raw_code),
    };
    let sector = match security_type {
        "etf" => etf_category(&name),
        "index" => "主要指数".to_string(),
        _ => value_string(row, "f100").unwrap_or_else(|| "未分类".to_string()),
    };
    Some(MarketQuote {
        code,
        raw_code: raw_code.clone(),
        name,
        market: market.to_string(),
        board,
        sector,
        security_type: security_type.to_string(),
        source: "eastmoney".to_string(),
        price,
        prev_close,
        change_pct,
        change_amt,
        open: value_f64(row, "f17"),
        high: value_f64(row, "f15"),
        low: value_f64(row, "f16"),
        volume_shares: value_f64(row, "f5").map(|value| value * 100.0),
        turnover_amount: value_f64(row, "f6"),
        market_cap_amount: value_f64(row, "f20"),
        float_market_cap_amount: value_f64(row, "f21"),
        turnover_rate: value_f64(row, "f8"),
        volume_ratio: value_f64(row, "f10"),
        pb: value_f64(row, "f23"),
        status: value_i64(row, "f292"),
    })
}

async fn fetch_tencent_snapshot(client: &Client, limit: usize) -> Result<Vec<MarketQuote>, String> {
    let url = "https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList";
    let page_size = 200usize;
    let first = fetch_tencent_page(client, url, 0, page_size).await?;
    let total = first
        .pointer("/data/total")
        .and_then(Value::as_u64)
        .unwrap_or(limit as u64) as usize;
    let requested = total.min(limit);
    let pages = requested.div_ceil(page_size).max(1);
    let mut quotes = tencent_rows(&first)?;
    for page in 1..pages {
        let value = fetch_tencent_page(client, url, page * page_size, page_size).await?;
        let rows = tencent_rows(&value)?;
        if rows.is_empty() {
            break;
        }
        quotes.extend(rows);
    }
    dedupe_quotes(quotes, limit)
}

async fn fetch_tencent_page(
    client: &Client,
    url: &str,
    offset: usize,
    count: usize,
) -> Result<Value, String> {
    let offset = offset.to_string();
    let count = count.to_string();
    let response = client
        .get(url)
        .query(&[
            ("_appver", "11.17.0"),
            ("board_code", "aStock"),
            ("sort_type", "price"),
            ("direct", "down"),
            ("offset", offset.as_str()),
            ("count", count.as_str()),
        ])
        .header("Referer", "https://stockapp.finance.qq.com/")
        .header("User-Agent", "Mozilla/5.0 AlphaStudioMarket/1.0")
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())
}

fn tencent_rows(value: &Value) -> Result<Vec<MarketQuote>, String> {
    let rows = value
        .pointer("/data/rank_list")
        .and_then(Value::as_array)
        .ok_or_else(|| "missing data.rank_list".to_string())?;
    Ok(rows.iter().filter_map(parse_tencent_quote).collect())
}

fn parse_tencent_quote(row: &Value) -> Option<MarketQuote> {
    let vendor_code = value_string(row, "code")?.to_lowercase();
    let (market, raw_code, suffix) = if let Some(code) = vendor_code.strip_prefix("sh") {
        ("SH", code, "XSHG")
    } else if let Some(code) = vendor_code.strip_prefix("sz") {
        ("SZ", code, "XSHE")
    } else {
        return None;
    };
    if raw_code.len() != 6 {
        return None;
    }
    let price = value_f64(row, "zxj")?;
    let change_amt = value_f64(row, "zd").unwrap_or(0.0);
    let prev_close = (price - change_amt).max(0.0);
    Some(MarketQuote {
        code: format!("{raw_code}.{suffix}"),
        raw_code: raw_code.to_string(),
        name: value_string(row, "name").unwrap_or_else(|| raw_code.to_string()),
        market: market.to_string(),
        board: board_from_code(raw_code),
        sector: "未分类".to_string(),
        security_type: "stock".to_string(),
        source: "tencent".to_string(),
        price,
        prev_close,
        change_pct: value_f64(row, "zdf").unwrap_or_else(|| {
            if prev_close > 0.0 {
                change_amt / prev_close * 100.0
            } else {
                0.0
            }
        }),
        change_amt,
        open: None,
        high: None,
        low: None,
        volume_shares: value_f64(row, "turnover").map(|value| value * 100.0),
        turnover_amount: value_f64(row, "volume").map(|value| value * 10_000.0),
        market_cap_amount: value_f64(row, "zsz").map(|value| value * 100_000_000.0),
        float_market_cap_amount: value_f64(row, "ltsz").map(|value| value * 100_000_000.0),
        turnover_rate: value_f64(row, "hsl"),
        volume_ratio: value_f64(row, "lb"),
        pb: value_f64(row, "pn"),
        status: None,
    })
}

fn dedupe_quotes(quotes: Vec<MarketQuote>, limit: usize) -> Result<Vec<MarketQuote>, String> {
    let mut seen = HashSet::new();
    let result = quotes
        .into_iter()
        .filter(|quote| seen.insert(quote.code.clone()))
        .take(limit)
        .collect::<Vec<_>>();
    if result.is_empty() {
        Err("provider returned no valid quotes".to_string())
    } else {
        Ok(result)
    }
}

fn board_from_code(code: &str) -> String {
    if code.starts_with("688") {
        "科创板"
    } else if code.starts_with("300") || code.starts_with("301") {
        "创业板"
    } else if code.starts_with('8') || code.starts_with('4') || code.starts_with("92") {
        "北交所"
    } else if code.starts_with('6') {
        "沪市主板"
    } else {
        "深市主板"
    }
    .to_string()
}

fn etf_category(name: &str) -> String {
    if ["国债", "债券", "政金债", "信用债", "城投债", "可转债"]
        .iter()
        .any(|keyword| name.contains(keyword))
    {
        "债券ETF"
    } else if ["黄金", "白银", "豆粕", "有色", "能源化工", "商品"]
        .iter()
        .any(|keyword| name.contains(keyword))
    {
        "商品ETF"
    } else if [
        "恒生",
        "港股",
        "纳指",
        "标普",
        "日经",
        "德国",
        "法国",
        "海外",
        "新兴亚洲",
    ]
    .iter()
    .any(|keyword| name.contains(keyword))
    {
        "跨境ETF"
    } else if [
        "沪深300",
        "中证500",
        "中证1000",
        "中证2000",
        "中证A500",
        "上证50",
        "科创50",
        "创业板",
        "深证100",
    ]
    .iter()
    .any(|keyword| name.contains(keyword))
    {
        "宽基ETF"
    } else {
        "行业主题ETF"
    }
    .to_string()
}

fn value_string(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(|value| match value {
        Value::String(text) if !text.trim().is_empty() && text.trim() != "-" => {
            Some(text.trim().to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn value_f64(row: &Value, key: &str) -> Option<f64> {
    row.get(key)
        .and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        })
        .filter(|value| value.is_finite())
}

fn value_i64(row: &Value, key: &str) -> Option<i64> {
    row.get(key).and_then(|value| match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_eastmoney_quote() {
        let row = serde_json::json!({"f12":"600519","f13":1,"f14":"贵州茅台","f2":1350.6,"f18":1361.76,"f3":-0.82,"f4":-11.16,"f5":737346,"f6":5512800000.0,"f15":1368.0,"f16":1340.0,"f17":1362.0,"f20":1688360000000.0,"f8":0.44,"f10":1.08,"f100":"白酒"});
        let quote = parse_eastmoney_quote_as(&row, "stock").unwrap();
        assert_eq!(quote.code, "600519.XSHG");
        assert_eq!(quote.sector, "白酒");
        assert_eq!(quote.source, "eastmoney");
    }

    #[test]
    fn normalizes_eastmoney_etf_quote() {
        let row = serde_json::json!({"f12":"510300","f13":1,"f14":"沪深300ETF","f2":4.12,"f18":4.08,"f3":0.98,"f4":0.04,"f5":1000,"f6":412000.0,"f15":4.13,"f16":4.07,"f17":4.08,"f20":120000000000.0,"f8":1.2,"f10":1.1,"f292":13});
        let quote = parse_eastmoney_quote_as(&row, "etf").unwrap();
        assert_eq!(quote.code, "510300.XSHG");
        assert_eq!(quote.board, "沪市ETF");
        assert_eq!(quote.sector, "宽基ETF");
        assert_eq!(quote.security_type, "etf");
    }

    #[test]
    fn normalizes_tencent_quote() {
        let row = serde_json::json!({"code":"sh600519","name":"贵州茅台","zxj":"1350.60","zd":"-11.16","zdf":"-0.82","turnover":"737346","volume":"55128.00","zsz":"16883.60","ltsz":"16883.60","hsl":"0.44","lb":"1.08"});
        let quote = parse_tencent_quote(&row).unwrap();
        assert_eq!(quote.code, "600519.XSHG");
        assert_eq!(quote.price, 1350.6);
        assert_eq!(quote.source, "tencent");
        assert_eq!(quote.turnover_amount, Some(551_280_000.0));
    }
}
