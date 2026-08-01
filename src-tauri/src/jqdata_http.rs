use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use serde_json::{json, Map, Number, Value};
use std::collections::HashSet;
use tokio::sync::Mutex;

const USER_AGENT: &str = "AlphaStudio/0.1 JQDataHttp";
const REQUEST_TIMEOUT_SECONDS: u64 = 65;

#[derive(Clone, Debug)]
struct CachedToken {
    api_url: String,
    username: String,
    day: String,
    value: String,
}

#[derive(Default)]
pub(crate) struct JqDataHttpClient {
    token: Mutex<Option<CachedToken>>,
    request_gate: Mutex<Option<std::time::Instant>>,
}

pub(crate) struct ProbeResult {
    pub(crate) query_count: Value,
    pub(crate) price_rows: Vec<Value>,
}

impl JqDataHttpClient {
    pub(crate) async fn clear_token(&self) {
        *self.token.lock().await = None;
    }

    async fn clear_token_if(&self, token: &str) {
        let mut cached = self.token.lock().await;
        if cached
            .as_ref()
            .map(|value| value.value.as_str() == token)
            .unwrap_or(false)
        {
            *cached = None;
        }
    }

    pub(crate) async fn probe(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
    ) -> Result<ProbeResult, String> {
        let query_count_text = self
            .request(
                api_url,
                username,
                password,
                json!({ "method": "get_query_count" }),
            )
            .await?;
        let query_count = parse_scalar(&query_count_text);
        let end_date = Local::now().format("%Y-%m-%d").to_string();
        let price_rows = self
            .request_rows(
                api_url,
                username,
                password,
                json!({
                    "method": "get_price",
                    "code": "000001.XSHE",
                    "count": 3,
                    "unit": "1d",
                    "end_date": end_date,
                    "skip_paused": false,
                    "fq_ref_date": end_date,
                }),
                Some("get_price"),
            )
            .await?;
        Ok(ProbeResult {
            query_count,
            price_rows,
        })
    }

    pub(crate) async fn query(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        method: &str,
        params: &Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        match method {
            "get_privilege" => Ok(vec![json!({
                "privilege": "JQData HTTP API（具体权限以各接口返回为准）"
            })]),
            "get_fundamentals_snapshot" => {
                self.fundamentals_snapshot(api_url, username, password, params)
                    .await
            }
            "get_company_research" => {
                self.company_research(api_url, username, password, params)
                    .await
            }
            "get_concept" => Err(
                "聚宽 HTTP API 不提供按股票反查全部概念的接口；其他行情、行业、财务与资金数据不受影响。"
                    .to_string(),
            ),
            "get_price" if security_codes(params).len() > 1 => {
                self.batch_price(api_url, username, password, params).await
            }
            "get_price" => {
                self.price_rows(api_url, username, password, params)
                    .await
            }
            _ => {
                let (payload, row_kind, limit) = build_payload(method, params)?;
                let mut rows = self
                    .request_rows(
                        api_url,
                        username,
                        password,
                        Value::Object(payload),
                        Some(row_kind.as_str()),
                    )
                    .await?;
                if let Some(limit) = limit {
                    rows.truncate(limit);
                }
                Ok(rows)
            }
        }
    }

    async fn batch_price(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        params: &Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        let codes = security_codes(params);
        let mut rows = Vec::new();
        let mut errors = Vec::new();
        for code in codes {
            let mut single = params.clone();
            single.remove("codes");
            single.remove("security_list");
            single.remove("stock_list");
            single.insert("code".to_string(), Value::String(code.clone()));
            match self.price_rows(api_url, username, password, &single).await {
                Ok(mut code_rows) => {
                    for row in &mut code_rows {
                        if let Some(object) = row.as_object_mut() {
                            object.insert("code".to_string(), Value::String(code.clone()));
                        }
                    }
                    rows.extend(code_rows);
                }
                Err(error) => errors.push(format!("{code}：{error}")),
            }
        }
        if rows.is_empty() && !errors.is_empty() {
            return Err(truncate_message(&errors.join("；")));
        }
        Ok(rows)
    }

    async fn price_rows(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        params: &Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        let (payload, _, _) = build_payload("get_price", params)?;
        let windows = price_date_windows(params);
        if windows.is_empty() {
            return self
                .request_rows(
                    api_url,
                    username,
                    password,
                    Value::Object(payload),
                    Some("get_price"),
                )
                .await;
        }

        let mut rows = Vec::new();
        for (start_date, end_date) in windows {
            let mut window_payload = payload.clone();
            window_payload.remove("date");
            window_payload.insert("start_date".to_string(), Value::String(start_date));
            window_payload.insert("end_date".to_string(), Value::String(end_date));
            window_payload.remove("count");
            rows.extend(
                self.request_rows(
                    api_url,
                    username,
                    password,
                    Value::Object(window_payload),
                    Some("get_price"),
                )
                .await?,
            );
        }

        let mut seen = HashSet::new();
        rows.retain(|row| {
            let key = row_sort_key(row);
            seen.insert(if key.is_empty() { row.to_string() } else { key })
        });
        rows.sort_by_key(row_sort_key);
        Ok(rows)
    }

    async fn fundamentals_snapshot(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        params: &Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        let code = string_param(params, &["code", "security"])
            .ok_or_else(|| "财务快照缺少 code 参数。".to_string())?;
        let date = string_param(params, &["date"]).unwrap_or_default();
        let specs = [
            (
                "valuation",
                "code,day,pe_ratio,pb_ratio,ps_ratio,pcf_ratio,market_cap,circulating_market_cap",
            ),
            (
                "indicator",
                "code,statDate,roe,roa,gross_profit_margin,net_profit_margin,inc_revenue_year_on_year,inc_net_profit_year_on_year",
            ),
            ("balance", "code,statDate,total_assets,total_liability"),
            (
                "cash_flow",
                "code,statDate,net_operate_cash_flow",
            ),
            ("income", "code,statDate,operating_revenue,net_profit"),
        ];
        let mut merged = Map::new();
        let mut errors = Vec::new();
        for (table, columns) in specs {
            let payload = json!({
                "method": "get_fundamentals",
                "table": table,
                "columns": columns,
                "code": code,
                "date": date,
                "count": 1,
            });
            match self
                .request_rows(
                    api_url,
                    username,
                    password,
                    payload,
                    Some("get_fundamentals"),
                )
                .await
            {
                Ok(rows) => {
                    if let Some(row) = rows.last().and_then(Value::as_object) {
                        for (key, value) in row {
                            if key != "id" && !value.is_null() {
                                merged.insert(key.clone(), value.clone());
                            }
                        }
                    }
                }
                Err(error) => errors.push(format!("{table}：{error}")),
            }
        }
        if merged.is_empty() && !errors.is_empty() {
            return Err(truncate_message(&errors.join("；")));
        }
        Ok(if merged.is_empty() {
            Vec::new()
        } else {
            vec![Value::Object(merged)]
        })
    }

    async fn company_research(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        params: &Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        let code = string_param(params, &["code", "security"])
            .ok_or_else(|| "公司研究缺少 code 参数。".to_string())?;
        let date = string_param(params, &["date"]);
        let specs = [
            (
                "shareholders",
                "finance.STK_SHAREHOLDER_TOP10",
                "pub_date",
                20,
            ),
            ("pledge", "finance.STK_SHARES_PLEDGE", "pub_date", 20),
            ("northbound", "finance.STK_HK_HOLD_INFO", "day", 30),
            ("forecast", "finance.STK_FIN_FORCAST", "pub_date", 20),
            (
                "performance",
                "finance.STK_PERFORMANCE_LETTERS",
                "pub_date",
                12,
            ),
        ];
        let mut all_rows = Vec::new();
        let mut errors = Vec::new();
        for (section, table, date_field, count) in specs {
            let mut conditions = format!("code#=#{code}");
            if let Some(date) = date.as_deref() {
                conditions.push_str(&format!("&{date_field}#<=#{date}"));
            }
            let payload = json!({
                "method": "run_query",
                "table": table,
                "conditions": conditions,
                "count": count,
            });
            match self
                .request_rows(api_url, username, password, payload, Some("run_query"))
                .await
            {
                Ok(mut rows) => {
                    for row in &mut rows {
                        if let Some(object) = row.as_object_mut() {
                            object
                                .insert("section".to_string(), Value::String(section.to_string()));
                        }
                    }
                    all_rows.extend(rows);
                }
                Err(error) => errors.push(format!("{section}：{error}")),
            }
        }
        if all_rows.is_empty() && !errors.is_empty() {
            return Err(truncate_message(&errors.join("；")));
        }
        Ok(all_rows)
    }

    async fn request_rows(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        payload: Value,
        method: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        let text = self.request(api_url, username, password, payload).await?;
        parse_rows(&text, method)
    }

    async fn request(
        &self,
        api_url: &str,
        username: &str,
        password: &str,
        mut payload: Value,
    ) -> Result<String, String> {
        let token = self.token(api_url, username, password).await?;
        payload
            .as_object_mut()
            .ok_or_else(|| "JQData 请求参数格式异常。".to_string())?
            .insert("token".to_string(), Value::String(token.clone()));
        let client = http_client()?;
        let first = self.post_text(&client, api_url, &payload).await?;
        if !is_expired_token_response(&first) {
            return validate_response(&first);
        }

        self.clear_token_if(&token).await;
        let token = self.token(api_url, username, password).await?;
        payload
            .as_object_mut()
            .expect("payload object")
            .insert("token".to_string(), Value::String(token));
        validate_response(&self.post_text(&client, api_url, &payload).await?)
    }

    async fn token(&self, api_url: &str, username: &str, password: &str) -> Result<String, String> {
        let normalized_url = api_url.trim().trim_end_matches('/').to_string();
        let normalized_user = username.trim().to_string();
        let day = Local::now().format("%Y-%m-%d").to_string();
        let mut cached = self.token.lock().await;
        if let Some(value) = cached.as_ref() {
            if value.api_url == normalized_url
                && value.username == normalized_user
                && value.day == day
            {
                return Ok(value.value.clone());
            }
        }

        let client = http_client()?;
        let payload = json!({
            "method": "get_current_token",
            "mob": normalized_user,
            "pwd": percent_encode(password.trim()),
        });
        let text = self.post_text(&client, &normalized_url, &payload).await?;
        let token = validate_token(&text)?;
        *cached = Some(CachedToken {
            api_url: normalized_url,
            username: username.trim().to_string(),
            day,
            value: token.clone(),
        });
        Ok(token)
    }

    async fn post_text(
        &self,
        client: &reqwest::Client,
        api_url: &str,
        payload: &Value,
    ) -> Result<String, String> {
        // The official service limits an account to 30 requests/second.
        // Space request starts at 25/second across concurrent Tauri commands.
        let mut last_start = self.request_gate.lock().await;
        if let Some(previous) = *last_start {
            let minimum_gap = std::time::Duration::from_millis(40);
            let elapsed = previous.elapsed();
            if elapsed < minimum_gap {
                tokio::time::sleep(minimum_gap - elapsed).await;
            }
        }
        *last_start = Some(std::time::Instant::now());
        drop(last_start);
        post_text(client, api_url, payload).await
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("无法创建 JQData HTTP 客户端：{error}"))
}

async fn post_text(
    client: &reqwest::Client,
    api_url: &str,
    payload: &Value,
) -> Result<String, String> {
    let response = client
        .post(api_url)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("JQData HTTP 请求失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("JQData HTTP 响应读取失败：{error}"))?;
    if !status.is_success() {
        let detail = truncate_message(text.trim());
        return Err(if detail.is_empty() {
            format!("JQData HTTP 接口返回 {status}。")
        } else {
            format!("JQData HTTP 接口返回 {status}：{detail}")
        });
    }
    Ok(text)
}

fn validate_token(text: &str) -> Result<String, String> {
    let token = text.trim().trim_matches('"');
    if token.is_empty() {
        return Err("JQData 认证未返回 token。".to_string());
    }
    if response_error(token).is_some()
        || token.contains('<')
        || token.contains('\n')
        || token.contains(',')
    {
        return Err(format!("JQData 认证失败：{}", truncate_message(token)));
    }
    Ok(token.to_string())
}

fn validate_response(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("JQData HTTP 接口返回空响应。".to_string());
    }
    if let Some(error) = response_error(trimmed) {
        return Err(format!("JQData 查询失败：{}", truncate_message(&error)));
    }
    Ok(trimmed.to_string())
}

fn response_error(text: &str) -> Option<String> {
    let lower = text.trim().to_ascii_lowercase();
    let is_error = lower.starts_with("error")
        || lower.starts_with("exception")
        || lower.starts_with("traceback")
        || lower.contains("invalid token")
        || lower.contains("token expired")
        || lower.contains("authentication failed")
        || lower.starts_with("<!doctype html")
        || lower.starts_with("<html");
    is_error.then(|| text.trim().to_string())
}

fn is_expired_token_response(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("invalid token") || lower.contains("token expired")
}

fn build_payload(
    method: &str,
    params: &Map<String, Value>,
) -> Result<(Map<String, Value>, String, Option<usize>), String> {
    let supported = [
        "get_query_count",
        "get_trade_days",
        "get_all_trade_days",
        "get_all_securities",
        "get_security_info",
        "get_price",
        "get_bars",
        "get_current_price",
        "get_fq_factor",
        "get_pause_stocks",
        "get_preopen_infos",
        "get_call_auction",
        "get_ticks",
        "get_extras",
        "get_fund_info",
        "get_index_stocks",
        "get_index_weights",
        "get_industries",
        "get_industry",
        "get_industry_stocks",
        "get_concepts",
        "get_concept_stocks",
        "get_money_flow",
        "get_money_flow_pro",
        "get_billboard_list",
        "get_mtss",
        "get_margincash_stocks",
        "get_marginsec_stocks",
        "get_locked_shares",
        "get_future_contracts",
        "get_dominant_future",
        "run_query",
        "get_fundamentals",
        "get_all_factors",
        "get_factor_values",
        "get_alpha101",
        "get_alpha191",
    ];
    let (remote_method, mut normalized) = if method == "get_constituents" {
        let kind = string_param(params, &["kind"]).unwrap_or_else(|| "industry".to_string());
        let remote = match kind.as_str() {
            "concept" => "get_concept_stocks",
            "index" => "get_index_stocks",
            _ => "get_industry_stocks",
        };
        (remote.to_string(), params.clone())
    } else if supported.contains(&method) {
        (method.to_string(), params.clone())
    } else {
        return Err(format!("JQData HTTP 暂不支持方法：{method}"));
    };

    let limit = normalized
        .remove("limit")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize);
    normalized.remove("fill_paused");
    let mut payload = Map::new();
    payload.insert("method".to_string(), Value::String(remote_method.clone()));

    if remote_method == "get_all_securities" {
        if let Some(types) = normalized
            .remove("types")
            .or_else(|| normalized.remove("security_types"))
        {
            if let Some(code) = value_as_csv(&types).split(',').next() {
                payload.insert("code".to_string(), Value::String(code.to_string()));
            }
        }
    }

    if method == "get_constituents" {
        if let Some(target) = normalized
            .remove("target")
            .or_else(|| normalized.remove("code"))
        {
            payload.insert("code".to_string(), Value::String(value_as_csv(&target)));
        }
        normalized.remove("kind");
    }

    let mut security = normalized
        .remove("codes")
        .or_else(|| normalized.remove("security"))
        .or_else(|| normalized.remove("security_list"))
        .or_else(|| normalized.remove("stock_list"));
    if security.is_none()
        && matches!(
            remote_method.as_str(),
            "get_preopen_infos" | "get_money_flow" | "get_money_flow_pro"
        )
    {
        security = normalized.remove("code");
    }
    if let Some(value) = security {
        let key = match remote_method.as_str() {
            "get_preopen_infos" => "security",
            "get_money_flow" | "get_money_flow_pro" => "security_list",
            _ => "code",
        };
        payload.insert(key.to_string(), Value::String(value_as_csv(&value)));
    }

    if remote_method == "get_industries" {
        if let Some(name) = normalized.remove("name") {
            normalized.insert("code".to_string(), name);
        }
    }

    if matches!(
        remote_method.as_str(),
        "get_mtss" | "get_billboard_list" | "get_locked_shares" | "get_trade_days"
    ) {
        if let Some(start) = normalized.remove("start_date") {
            normalized.entry("date".to_string()).or_insert(start);
        }
    }

    if remote_method == "get_locked_shares" && !normalized.contains_key("end_date") {
        let start = normalized
            .get("date")
            .and_then(Value::as_str)
            .map(str::to_string);
        let days = normalized
            .remove("forward_count")
            .and_then(|value| value.as_i64());
        if let (Some(start), Some(days)) = (start, days) {
            if let Ok(date) = NaiveDate::parse_from_str(&start, "%Y-%m-%d") {
                normalized.insert(
                    "end_date".to_string(),
                    Value::String(
                        (date + ChronoDuration::days(days))
                            .format("%Y-%m-%d")
                            .to_string(),
                    ),
                );
            }
        }
    }
    normalized.remove("forward_count");

    if matches!(remote_method.as_str(), "get_price" | "get_bars") {
        if let Some(frequency) = normalized.remove("frequency") {
            normalized.insert(
                "unit".to_string(),
                Value::String(normalize_frequency(&value_as_csv(&frequency))),
            );
        } else if let Some(unit) = normalized.get_mut("unit") {
            *unit = Value::String(normalize_frequency(&value_as_csv(unit)));
        }
        normalized.remove("fields");
        if let Some(fq) = normalized
            .remove("fq")
            .and_then(|value| value.as_str().map(str::to_string))
        {
            match fq.as_str() {
                "pre" => {
                    let reference = normalized
                        .get("end_date")
                        .and_then(Value::as_str)
                        .map(|value| value.chars().take(10).collect::<String>())
                        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
                    normalized.insert("fq_ref_date".to_string(), Value::String(reference));
                }
                "post" => {
                    normalized.insert(
                        "fq_ref_date".to_string(),
                        Value::String("2000-01-01".to_string()),
                    );
                }
                _ => {}
            }
        } else if remote_method == "get_price" {
            let reference = normalized
                .get("end_date")
                .and_then(Value::as_str)
                .map(|value| value.chars().take(10).collect::<String>())
                .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
            normalized.insert("fq_ref_date".to_string(), Value::String(reference));
        }
    }

    if remote_method == "get_preopen_infos" {
        if let Some(fields) = normalized.remove("fields") {
            normalized.insert("field".to_string(), fields);
        }
    }

    for (key, value) in normalized {
        if key == "types" || value.is_null() {
            continue;
        }
        let value = if matches!(key.as_str(), "field" | "fields") {
            value
        } else {
            normalize_parameter(value)
        };
        payload.insert(key, value);
    }
    Ok((payload, remote_method, limit))
}

fn parse_rows(text: &str, method: Option<&str>) -> Result<Vec<Value>, String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return Ok(match value {
                Value::Array(values) => values
                    .into_iter()
                    .map(|value| match value {
                        Value::Object(_) => value,
                        other => json!({ "value": other }),
                    })
                    .collect(),
                Value::Object(_) => vec![value],
                other => vec![json!({ "value": other })],
            });
        }
    }

    if !trimmed.contains(',') {
        if method == Some("get_preopen_infos") {
            let mut lines = trimmed.lines().filter(|line| !line.trim().is_empty());
            if let Some(header_line) = lines.next() {
                let headers = header_line.split_whitespace().collect::<Vec<_>>();
                let mut rows = Vec::new();
                for line in lines {
                    let values = line.split_whitespace().collect::<Vec<_>>();
                    if values.len() != headers.len() + 1 {
                        continue;
                    }
                    let mut row = Map::new();
                    row.insert("code".to_string(), parse_scalar(values[0]));
                    for (header, value) in headers.iter().zip(values.iter().skip(1)) {
                        row.insert((*header).to_string(), parse_scalar(value));
                    }
                    normalize_row(&mut row);
                    rows.push(Value::Object(row));
                }
                if !rows.is_empty() {
                    return Ok(rows);
                }
            }
        }
        let key = match method {
            Some("get_trade_days") | Some("get_all_trade_days") => "date",
            Some("get_index_stocks")
            | Some("get_industry_stocks")
            | Some("get_concept_stocks")
            | Some("get_margincash_stocks")
            | Some("get_marginsec_stocks")
            | Some("get_future_contracts")
            | Some("get_dominant_future") => "code",
            Some("get_query_count") => "count",
            _ => "value",
        };
        return Ok(trimmed
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| json!({ key: parse_scalar(line) }))
            .collect());
    }

    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(trimmed.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| format!("JQData CSV 表头解析失败：{error}"))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| format!("JQData CSV 数据解析失败：{error}"))?;
        let mut row = Map::new();
        for (index, header) in headers.iter().enumerate() {
            let key = header.trim();
            if key.is_empty() {
                continue;
            }
            row.insert(
                key.to_string(),
                record.get(index).map(parse_scalar).unwrap_or(Value::Null),
            );
        }
        if !row.is_empty() {
            normalize_row(&mut row);
            rows.push(Value::Object(row));
        }
    }
    Ok(rows)
}

fn normalize_row(row: &mut Map<String, Value>) {
    if !row.contains_key("date") {
        if let Some(day) = row.get("day").cloned() {
            row.insert("date".to_string(), day);
        }
    }
    if !row.contains_key("net_amount_main") {
        let components = ["netflow_xl", "netflow_l"]
            .iter()
            .filter_map(|key| row.get(*key).and_then(Value::as_f64))
            .collect::<Vec<_>>();
        if !components.is_empty() {
            let main_net = components.into_iter().sum::<f64>();
            if let Some(number) = Number::from_f64(main_net) {
                row.insert("net_amount_main".to_string(), Value::Number(number));
            }
        }
    }
}

fn parse_scalar(value: &str) -> Value {
    let value = value.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("none")
        || value.eq_ignore_ascii_case("null")
        || value.eq_ignore_ascii_case("nan")
    {
        return Value::Null;
    }
    if value.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if value.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Ok(number) = value.parse::<i64>() {
        return Value::Number(number.into());
    }
    if let Ok(number) = value.parse::<f64>() {
        if let Some(number) = Number::from_f64(number) {
            return Value::Number(number);
        }
    }
    Value::String(value.to_string())
}

fn normalize_parameter(value: Value) -> Value {
    match value {
        Value::Array(_) => Value::String(value_as_csv(&value)),
        other => other,
    }
}

fn value_as_csv(value: &Value) -> String {
    match value {
        Value::Array(values) => values
            .iter()
            .filter_map(|value| match value {
                Value::String(value) => Some(value.clone()),
                Value::Number(value) => Some(value.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        _ => String::new(),
    }
}

fn normalize_frequency(value: &str) -> String {
    match value {
        "daily" => "1d".to_string(),
        "minute" => "1m".to_string(),
        other => other.to_string(),
    }
}

fn price_date_windows(params: &Map<String, Value>) -> Vec<(String, String)> {
    let Some(start_text) = string_param(params, &["start_date", "date"]) else {
        return Vec::new();
    };
    let Some(end_text) = string_param(params, &["end_date"]) else {
        return Vec::new();
    };
    let Some(start) = start_text
        .get(..10)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Vec::new();
    };
    let Some(end) = end_text
        .get(..10)
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    else {
        return Vec::new();
    };
    if start > end {
        return Vec::new();
    }

    let unit = string_param(params, &["unit", "frequency"]).unwrap_or_else(|| "1d".to_string());
    let minute = matches!(unit.as_str(), "1m" | "minute" | "minutes");
    // HTTP ranges are capped at 30 trading days and each response at 5,000
    // bars. Fourteen calendar days keep minute responses comfortably below
    // that cap; 35 calendar days stay below 30 trading days for daily bars.
    let window_days = if minute { 13 } else { 34 };
    let mut windows = Vec::new();
    let mut cursor = start;
    while cursor <= end {
        let window_end = std::cmp::min(cursor + ChronoDuration::days(window_days), end);
        let window_start_text = if cursor == start {
            start_text.clone()
        } else if minute {
            format!("{} 09:30:00", cursor.format("%Y-%m-%d"))
        } else {
            cursor.format("%Y-%m-%d").to_string()
        };
        let window_end_text = if window_end == end {
            end_text.clone()
        } else if minute {
            format!("{} 15:00:00", window_end.format("%Y-%m-%d"))
        } else {
            window_end.format("%Y-%m-%d").to_string()
        };
        windows.push((window_start_text, window_end_text));
        cursor = window_end + ChronoDuration::days(1);
    }
    windows
}

fn row_sort_key(row: &Value) -> String {
    ["date", "time", "index"]
        .iter()
        .find_map(|key| row.get(*key))
        .map(|value| match value {
            Value::String(value) => value.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default()
}

fn security_codes(params: &Map<String, Value>) -> Vec<String> {
    for key in ["codes", "code", "security", "security_list", "stock_list"] {
        if let Some(value) = params.get(key) {
            let values = value_as_csv(value)
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if !values.is_empty() {
                return values;
            }
        }
    }
    Vec::new()
}

fn string_param(params: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| params.get(*key))
        .map(value_as_csv)
        .filter(|value| !value.trim().is_empty())
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

fn truncate_message(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= 240 {
        return trimmed.to_string();
    }
    let mut short = trimmed.chars().take(240).collect::<String>();
    short.push_str("...");
    short
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_csv_with_quotes_and_numeric_values() {
        let rows = parse_rows(
            "code,name,close,note\n000001.XSHE,\"平安,银行\",10.25,\n",
            Some("get_price"),
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["code"], "000001.XSHE");
        assert_eq!(rows[0]["name"], "平安,银行");
        assert_eq!(rows[0]["close"], 10.25);
        assert!(rows[0]["note"].is_null());
    }

    #[test]
    fn normalizes_http_day_and_money_flow_fields_for_the_frontend() {
        let rows = parse_rows(
            "day,netflow_xl,netflow_l\n2026-07-28,100.5,-20.0\n",
            Some("get_money_flow"),
        )
        .unwrap();
        assert_eq!(rows[0]["date"], "2026-07-28");
        assert_eq!(rows[0]["net_amount_main"], 80.5);
    }

    #[test]
    fn maps_plain_line_responses_to_method_specific_fields() {
        let rows = parse_rows("2026-07-24\n2026-07-27\n", Some("get_trade_days")).unwrap();
        assert_eq!(rows[0]["date"], "2026-07-24");
        assert_eq!(rows[1]["date"], "2026-07-27");
    }

    #[test]
    fn maps_price_params_to_http_contract() {
        let params = Map::from_iter([
            ("code".to_string(), json!("000001.XSHE")),
            ("unit".to_string(), json!("1d")),
            ("end_date".to_string(), json!("2026-07-27")),
            ("fq".to_string(), json!("pre")),
            ("fields".to_string(), json!(["open", "close"])),
            ("fill_paused".to_string(), json!(true)),
        ]);
        let (payload, method, _) = build_payload("get_price", &params).unwrap();
        assert_eq!(method, "get_price");
        assert_eq!(payload["code"], "000001.XSHE");
        assert_eq!(payload["unit"], "1d");
        assert_eq!(payload["fq_ref_date"], "2026-07-27");
        assert!(!payload.contains_key("fq"));
        assert!(!payload.contains_key("fields"));
        assert!(!payload.contains_key("fill_paused"));
    }

    #[test]
    fn maps_locked_share_forward_window_to_end_date() {
        let params = Map::from_iter([
            ("code".to_string(), json!("000001.XSHE")),
            ("start_date".to_string(), json!("2026-07-28")),
            ("forward_count".to_string(), json!(10)),
        ]);
        let (payload, _, _) = build_payload("get_locked_shares", &params).unwrap();
        assert_eq!(payload["date"], "2026-07-28");
        assert_eq!(payload["end_date"], "2026-08-07");
        assert!(!payload.contains_key("forward_count"));
    }

    #[test]
    fn maps_money_flow_code_to_http_security_list() {
        let params = Map::from_iter([
            ("code".to_string(), json!("000001.XSHE")),
            ("end_date".to_string(), json!("2026-07-28")),
            ("count".to_string(), json!(10)),
        ]);
        let (payload, _, _) = build_payload("get_money_flow", &params).unwrap();
        assert_eq!(payload["security_list"], "000001.XSHE");
        assert!(!payload.contains_key("code"));
    }

    #[test]
    fn maps_and_parses_preopen_info_contract() {
        let params = Map::from_iter([
            ("code".to_string(), json!("000001.XSHE")),
            (
                "fields".to_string(),
                json!(["paused", "factor", "high_limit", "low_limit"]),
            ),
        ]);
        let (payload, _, _) = build_payload("get_preopen_infos", &params).unwrap();
        assert_eq!(payload["security"], "000001.XSHE");
        assert_eq!(
            payload["field"],
            json!(["paused", "factor", "high_limit", "low_limit"])
        );
        assert!(!payload.contains_key("code"));

        let rows = parse_rows(
            "paused factor high_limit low_limit\n000001.XSHE 0.0 135.995625 11.01 9.01\n",
            Some("get_preopen_infos"),
        )
        .unwrap();
        assert_eq!(rows[0]["code"], "000001.XSHE");
        assert_eq!(rows[0]["high_limit"], 11.01);
    }

    #[test]
    fn splits_long_daily_and_minute_price_ranges() {
        let daily = Map::from_iter([
            ("start_date".to_string(), json!("2026-01-01")),
            ("end_date".to_string(), json!("2026-04-30")),
            ("unit".to_string(), json!("1d")),
        ]);
        let daily_windows = price_date_windows(&daily);
        assert_eq!(daily_windows.first().unwrap().0, "2026-01-01");
        assert_eq!(daily_windows.last().unwrap().1, "2026-04-30");
        assert!(daily_windows.len() > 1);

        let minute = Map::from_iter([
            ("start_date".to_string(), json!("2026-07-01 09:30:00")),
            ("end_date".to_string(), json!("2026-07-31 15:00:00")),
            ("unit".to_string(), json!("1m")),
        ]);
        let minute_windows = price_date_windows(&minute);
        assert_eq!(minute_windows.first().unwrap().0, "2026-07-01 09:30:00");
        assert_eq!(minute_windows.last().unwrap().1, "2026-07-31 15:00:00");
        assert!(minute_windows.len() > 1);
    }

    #[test]
    fn percent_encodes_password_for_joinquant_auth() {
        assert_eq!(percent_encode("a+b 中文"), "a%2Bb%20%E4%B8%AD%E6%96%87");
    }

    #[test]
    fn recognizes_token_errors_without_misclassifying_csv() {
        assert!(response_error("error: invalid token").is_some());
        assert!(response_error("<html>bad gateway</html>").is_some());
        assert!(response_error("code,name\n000001.XSHE,平安银行").is_none());
    }
}
