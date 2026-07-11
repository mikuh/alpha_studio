#!/usr/bin/env bash
#
# mac-network-restore.sh — 备份 / 恢复 / 重置 macOS 网络配置
#
# 用法:
#   sudo ./mac-network-restore.sh backup          # 保存当前配置为「原始基线」
#   sudo ./mac-network-restore.sh restore         # 一键恢复到基线（默认命令）
#   sudo ./mac-network-restore.sh reset           # 重置为系统默认（DHCP、无代理、无自定义 DNS）
#   ./mac-network-restore.sh status               # 查看当前配置与基线差异
#   sudo ./mac-network-restore.sh restore --dry-run
#
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"

DATA_DIR="${MAC_NETWORK_RESTORE_DIR:-$HOME/.local/share/mac-network-restore}"
BASELINE_DIR=""
BASELINE_META=""
BASELINE_HOSTS=""
BASELINE_LOCATION=""
BASELINE_SERVICE_ORDER=""
BASELINE_WIFI=""
BASELINE_SERVICES=""
WIFI_DEVICE=""

DRY_RUN=0
FORCE=0

log()  { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s] 警告: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die()  { printf '[%s] 错误: %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
macOS 网络配置一键恢复工具

用法:
  $SCRIPT_NAME backup              保存当前网络配置为「原始基线」
  $SCRIPT_NAME restore             从基线恢复（无参数时默认执行此命令）
  $SCRIPT_NAME reset               重置为系统默认配置（不依赖基线）
  $SCRIPT_NAME status              对比当前配置与基线
  $SCRIPT_NAME help                显示此帮助

选项:
  --dry-run                        仅打印将要执行的命令，不实际修改
  --force                          跳确认提示（restore / reset）
  --dir PATH                       自定义基线目录（默认: ${DATA_DIR}）

说明:
  - backup / restore / reset 需要管理员权限，请使用 sudo 运行。
  - 首次使用前请先执行一次 backup，将「干净/原始」状态保存为基线。
  - reset 会将各网络服务设为 DHCP、关闭代理、清除自定义 DNS，不会删除 VPN 软件本身。

示例:
  sudo $SCRIPT_NAME backup
  sudo $SCRIPT_NAME restore
  sudo $SCRIPT_NAME reset --dry-run
EOF
}

init_paths() {
  BASELINE_DIR="$DATA_DIR/baseline"
  BASELINE_META="$BASELINE_DIR/meta.env"
  BASELINE_HOSTS="$BASELINE_DIR/hosts"
  BASELINE_LOCATION="$BASELINE_DIR/location.txt"
  BASELINE_SERVICE_ORDER="$BASELINE_DIR/service-order.txt"
  BASELINE_WIFI="$BASELINE_DIR/preferred-wifi.txt"
  BASELINE_SERVICES="$BASELINE_DIR/services"
  WIFI_DEVICE="$(networksetup -listallhardwareports 2>/dev/null | awk '/Hardware Port: Wi-Fi/{found=1} found && /^Device:/{print $2; exit}')"
}

require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || die "此脚本仅支持 macOS"
  command -v networksetup >/dev/null 2>&1 || die "未找到 networksetup 命令"
}

require_root() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "此操作需要管理员权限，请使用: sudo $SCRIPT_NAME $*"
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] $*"
  else
    log "执行: $*"
    "$@"
  fi
}

run_cmd_or_warn() {
  if ! run_cmd "$@"; then
    warn "命令失败: $*"
  fi
}

clear_search_domains() {
  local service="$1"
  run_cmd networksetup -setsearchdomains "$service" Empty
}

confirm() {
  local prompt="$1"
  if [[ "$FORCE" -eq 1 ]]; then
    return 0
  fi
  printf '%s [y/N] ' "$prompt"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

sanitize_name() {
  printf '%s' "$1" | tr '/:' '__'
}

list_services() {
  networksetup -listallnetworkservices 2>/dev/null \
    | sed '1d' \
    | sed 's/^\*//' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

list_disabled_services() {
  networksetup -listallnetworkservices 2>/dev/null \
    | sed '1d' \
    | awk '/^\*/ { gsub(/^\*[[:space:]]*/, "", $0); print }'
}

is_disabled_service() {
  local service="$1"
  list_disabled_services | grep -Fxq "$service"
}

# --- 解析 networksetup 输出 ---

parse_ipv4_mode() {
  local info="$1"
  if grep -q "DHCP Configuration" <<<"$info"; then
    echo "dhcp"
  elif grep -q "Manual Configuration" <<<"$info"; then
    echo "manual"
  elif grep -q "BOOTP Configuration" <<<"$info"; then
    echo "bootp"
  elif grep -qi "IPv4: Off\|Off (Manual)" <<<"$info"; then
    echo "off"
  else
    echo "dhcp"
  fi
}

parse_field() {
  local info="$1" label="$2"
  printf '%s\n' "$info" | awk -F': ' -v k="$label" '$1 == k { print $2; exit }'
}

parse_ipv6_mode() {
  local info="$1"
  local mode
  mode="$(parse_field "$info" "IPv6")"
  case "$mode" in
    Automatic) echo "automatic" ;;
    "Link Local") echo "linklocal" ;;
    Manual) echo "manual" ;;
    Off) echo "off" ;;
    *) echo "automatic" ;;
  esac
}

parse_proxy() {
  local output="$1"
  local enabled server port auth
  enabled="$(printf '%s\n' "$output" | awk -F': ' '/^Enabled:/ { print $2; exit }')"
  server="$(printf '%s\n' "$output" | awk -F': ' '/^Server:/ { print $2; exit }')"
  port="$(printf '%s\n' "$output" | awk -F': ' '/^Port:/ { print $2; exit }')"
  auth="$(printf '%s\n' "$output" | awk -F': ' '/^Authenticated Proxy Enabled:/ { print $2; exit }')"
  [[ -n "$enabled" ]] || enabled="No"
  [[ -n "$server" ]] || server=""
  [[ -n "$port" ]] || port=""
  [[ -n "$auth" ]] || auth="0"
  printf '%s|%s|%s|%s' "$enabled" "$server" "$port" "$auth"
}

parse_list_or_empty() {
  local output="$1"
  if grep -qi "There aren't any\|There are no" <<<"$output"; then
    echo ""
  else
    printf '%s' "$output" | tr '\n' ',' | sed 's/,$//'
  fi
}

parse_routes_v4() {
  local output="$1"
  if grep -qi "There are no additional" <<<"$output"; then
    echo ""
    return
  fi
  printf '%s' "$output" | awk 'NF == 3 { printf "%s|%s|%s\n", $1, $2, $3 }' | paste -sd ';' -
}

parse_routes_v6() {
  local output="$1"
  if grep -qi "There are no additional" <<<"$output"; then
    echo ""
    return
  fi
  printf '%s' "$output" | awk 'NF == 3 { printf "%s|%s|%s\n", $1, $2, $3 }' | paste -sd ';' -
}

write_kv() {
  local file="$1" key="$2" value="$3"
  printf '%s=%q\n' "$key" "$value" >>"$file"
}

read_kv() {
  local file="$1" key="$2"
  local line reply
  line="$(grep -E "^${key}=" "$file" | tail -1 || true)"
  [[ -n "$line" ]] || return 1
  eval "reply=${line#*=}"
  printf '%s' "$reply"
}

# --- 备份 ---

backup_service() {
  local service="$1"
  local safe file info
  safe="$(sanitize_name "$service")"
  file="$BASELINE_SERVICES/${safe}.env"
  mkdir -p "$BASELINE_SERVICES"
  : >"$file"

  info="$(networksetup -getinfo "$service" 2>/dev/null || true)"
  write_kv "$file" "service" "$service"
  if is_disabled_service "$service"; then
    write_kv "$file" "enabled" "off"
  else
    write_kv "$file" "enabled" "on"
  fi

  write_kv "$file" "ipv4_mode" "$(parse_ipv4_mode "$info")"
  write_kv "$file" "ipv4_client_id" "$(parse_field "$info" "Client ID")"
  write_kv "$file" "ipv4_ip" "$(parse_field "$info" "IP address")"
  write_kv "$file" "ipv4_subnet" "$(parse_field "$info" "Subnet mask")"
  write_kv "$file" "ipv4_router" "$(parse_field "$info" "Router")"
  write_kv "$file" "ipv6_mode" "$(parse_ipv6_mode "$info")"
  write_kv "$file" "ipv6_ip" "$(parse_field "$info" "IPv6 IP address")"
  write_kv "$file" "ipv6_prefix" "$(parse_field "$info" "IPv6 Prefix")"
  write_kv "$file" "ipv6_router" "$(parse_field "$info" "IPv6 Router")"

  write_kv "$file" "dns_servers" "$(parse_list_or_empty "$(networksetup -getdnsservers "$service" 2>/dev/null || true)")"
  write_kv "$file" "search_domains" "$(parse_list_or_empty "$(networksetup -getsearchdomains "$service" 2>/dev/null || true)")"

  local proxy
  proxy="$(parse_proxy "$(networksetup -getwebproxy "$service" 2>/dev/null || true)")"
  write_kv "$file" "web_proxy" "$proxy"
  proxy="$(parse_proxy "$(networksetup -getsecurewebproxy "$service" 2>/dev/null || true)")"
  write_kv "$file" "secure_web_proxy" "$proxy"
  proxy="$(parse_proxy "$(networksetup -getsocksfirewallproxy "$service" 2>/dev/null || true)")"
  write_kv "$file" "socks_proxy" "$proxy"

  local autodiscovery
  autodiscovery="$(networksetup -getproxyautodiscovery "$service" 2>/dev/null || true)"
  if grep -qi "On" <<<"$autodiscovery"; then
    write_kv "$file" "proxy_autodiscovery" "on"
  else
    write_kv "$file" "proxy_autodiscovery" "off"
  fi

  write_kv "$file" "proxy_bypass" "$(parse_list_or_empty "$(networksetup -getproxybypassdomains "$service" 2>/dev/null || true)")"
  write_kv "$file" "routes_v4" "$(parse_routes_v4 "$(networksetup -getadditionalroutes "$service" 2>/dev/null || true)")"
  write_kv "$file" "routes_v6" "$(parse_routes_v6 "$(networksetup -getv6additionalroutes "$service" 2>/dev/null || true)")"
}

backup_wifi_preferred() {
  if [[ -z "$WIFI_DEVICE" ]]; then
    return 0
  fi
  networksetup -listpreferredwirelessnetworks "$WIFI_DEVICE" 2>/dev/null >"$BASELINE_WIFI" || : >"$BASELINE_WIFI"
}

cmd_backup() {
  require_root "backup"
  mkdir -p "$BASELINE_DIR" "$BASELINE_SERVICES"

  log "开始备份网络配置到: $BASELINE_DIR"

  local service
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    log "备份服务: $service"
    backup_service "$service"
  done < <(list_services)

  networksetup -getcurrentlocation >"$BASELINE_LOCATION" 2>/dev/null || echo "Automatic" >"$BASELINE_LOCATION"
  networksetup -listnetworkserviceorder >"$BASELINE_SERVICE_ORDER" 2>/dev/null || true
  backup_wifi_preferred

  if [[ -r /etc/hosts ]]; then
    cp /etc/hosts "$BASELINE_HOSTS"
  else
    : >"$BASELINE_HOSTS"
  fi

  cat >"$BASELINE_META" <<EOF
BACKUP_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
HOSTNAME="$(scutil --get ComputerName 2>/dev/null || hostname)"
MACOS_VERSION="$(sw_vers -productVersion 2>/dev/null || true)"
WIFI_DEVICE="$WIFI_DEVICE"
EOF

  log "备份完成。"
  log "基线目录: $BASELINE_DIR"
  log "恢复命令: sudo $SCRIPT_NAME restore"
}

# --- 恢复 ---

apply_proxy() {
  local service="$1" kind="$2" spec="$3"
  local enabled server port auth
  IFS='|' read -r enabled server port auth <<<"$spec"

  case "$kind" in
    web)
      if [[ "$enabled" == "Yes" && -n "$server" && -n "$port" ]]; then
        run_cmd networksetup -setwebproxy "$service" "$server" "$port" "$auth"
        run_cmd networksetup -setwebproxystate "$service" on
      else
        run_cmd networksetup -setwebproxystate "$service" off
      fi
      ;;
    secure)
      if [[ "$enabled" == "Yes" && -n "$server" && -n "$port" ]]; then
        run_cmd networksetup -setsecurewebproxy "$service" "$server" "$port" "$auth"
        run_cmd networksetup -setsecurewebproxystate "$service" on
      else
        run_cmd networksetup -setsecurewebproxystate "$service" off
      fi
      ;;
    socks)
      if [[ "$enabled" == "Yes" && -n "$server" && -n "$port" ]]; then
        run_cmd networksetup -setsocksfirewallproxy "$service" "$server" "$port" "$auth"
        run_cmd networksetup -setsocksfirewallproxystate "$service" on
      else
        run_cmd networksetup -setsocksfirewallproxystate "$service" off
      fi
      ;;
  esac
}

apply_routes() {
  local service="$1" version="$2" routes="$3"
  if [[ "$version" == "v4" ]]; then
    if [[ -z "$routes" ]]; then
      run_cmd networksetup -setadditionalroutes "$service"
      return
    fi
    local args=()
    local entry dest mask gw
    IFS=';' read -ra entries <<<"$routes"
    for entry in "${entries[@]}"; do
      IFS='|' read -r dest mask gw <<<"$entry"
      args+=("$dest" "$mask" "$gw")
    done
    run_cmd networksetup -setadditionalroutes "$service" "${args[@]}"
  else
    if [[ -z "$routes" ]]; then
      run_cmd networksetup -setv6additionalroutes "$service"
      return
    fi
    local args=()
    local entry dest prefix gw
    IFS=';' read -ra entries <<<"$routes"
    for entry in "${entries[@]}"; do
      IFS='|' read -r dest prefix gw <<<"$entry"
      args+=("$dest" "$prefix" "$gw")
    done
    run_cmd networksetup -setv6additionalroutes "$service" "${args[@]}"
  fi
}

restore_service_from_file() {
  local file="$1"
  local service enabled

  service="$(read_kv "$file" service)"
  enabled="$(read_kv "$file" enabled || echo on)"

  log "恢复服务: $service"

  if [[ "$enabled" == "off" ]]; then
    run_cmd networksetup -setnetworkserviceenabled "$service" off || warn "无法禁用 $service"
  else
    run_cmd networksetup -setnetworkserviceenabled "$service" on || warn "无法启用 $service"
  fi

  local ipv4_mode ipv4_client_id ipv4_ip ipv4_subnet ipv4_router
  ipv4_mode="$(read_kv "$file" ipv4_mode)"
  ipv4_client_id="$(read_kv "$file" ipv4_client_id || true)"
  ipv4_ip="$(read_kv "$file" ipv4_ip || true)"
  ipv4_subnet="$(read_kv "$file" ipv4_subnet || true)"
  ipv4_router="$(read_kv "$file" ipv4_router || true)"

  case "$ipv4_mode" in
    dhcp)
      if [[ -n "$ipv4_client_id" ]]; then
        run_cmd networksetup -setdhcp "$service" "$ipv4_client_id"
      else
        run_cmd networksetup -setdhcp "$service"
      fi
      ;;
    manual)
      run_cmd networksetup -setmanual "$service" "$ipv4_ip" "$ipv4_subnet" "$ipv4_router"
      ;;
    bootp)
      run_cmd networksetup -setbootp "$service"
      ;;
    off)
      run_cmd networksetup -setv4off "$service"
      ;;
  esac

  local ipv6_mode ipv6_ip ipv6_prefix ipv6_router
  ipv6_mode="$(read_kv "$file" ipv6_mode)"
  ipv6_ip="$(read_kv "$file" ipv6_ip || true)"
  ipv6_prefix="$(read_kv "$file" ipv6_prefix || true)"
  ipv6_router="$(read_kv "$file" ipv6_router || true)"

  case "$ipv6_mode" in
    automatic) run_cmd networksetup -setv6automatic "$service" ;;
    linklocal) run_cmd networksetup -setv6LinkLocal "$service" ;;
    manual)
      run_cmd networksetup -setv6manual "$service" "$ipv6_ip" "$ipv6_prefix" "$ipv6_router"
      ;;
    off) run_cmd networksetup -setv6off "$service" ;;
  esac

  local dns_servers search_domains
  dns_servers="$(read_kv "$file" dns_servers || true)"
  if [[ -z "$dns_servers" ]]; then
    run_cmd networksetup -setdnsservers "$service" Empty
  else
    # shellcheck disable=SC2206
    local dns_array=(${dns_servers//,/ })
    run_cmd networksetup -setdnsservers "$service" "${dns_array[@]}"
  fi

  search_domains="$(read_kv "$file" search_domains || true)"
  if [[ -z "$search_domains" ]]; then
    clear_search_domains "$service"
  else
    # shellcheck disable=SC2206
    local domain_array=(${search_domains//,/ })
    run_cmd networksetup -setsearchdomains "$service" "${domain_array[@]}"
  fi

  apply_proxy "$service" web "$(read_kv "$file" web_proxy)"
  apply_proxy "$service" secure "$(read_kv "$file" secure_web_proxy)"
  apply_proxy "$service" socks "$(read_kv "$file" socks_proxy)"

  local autodiscovery
  autodiscovery="$(read_kv "$file" proxy_autodiscovery || echo off)"
  run_cmd networksetup -setproxyautodiscovery "$service" "$autodiscovery"

  local bypass
  bypass="$(read_kv "$file" proxy_bypass || true)"
  if [[ -z "$bypass" ]]; then
    run_cmd networksetup -setproxybypassdomains "$service" Empty
  else
    # shellcheck disable=SC2206
    local bypass_array=(${bypass//,/ })
    run_cmd networksetup -setproxybypassdomains "$service" "${bypass_array[@]}"
  fi

  apply_routes "$service" v4 "$(read_kv "$file" routes_v4 || true)"
  apply_routes "$service" v6 "$(read_kv "$file" routes_v6 || true)"
}

restore_service_order() {
  [[ -f "$BASELINE_SERVICE_ORDER" ]] || return 0
  local services=()
  local line service
  while IFS= read -r line; do
    if [[ "$line" =~ ^\([0-9]+\)[[:space:]](.+)$ ]]; then
      service="${BASH_REMATCH[1]}"
      services+=("$service")
    fi
  done <"$BASELINE_SERVICE_ORDER"
  [[ "${#services[@]}" -gt 0 ]] || return 0
  run_cmd networksetup -ordernetworkservices "${services[@]}"
}

restore_location() {
  [[ -f "$BASELINE_LOCATION" ]] || return 0
  local location
  location="$(tr -d '\n' <"$BASELINE_LOCATION")"
  [[ -n "$location" ]] || return 0
  run_cmd networksetup -switchtolocation "$location"
}

restore_hosts() {
  [[ -f "$BASELINE_HOSTS" ]] || return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] 恢复 /etc/hosts 自 $BASELINE_HOSTS"
  else
    cp "$BASELINE_HOSTS" /etc/hosts
    log "已恢复 /etc/hosts"
  fi
}

flush_network_caches() {
  run_cmd dscacheutil -flushcache
  if [[ "$DRY_RUN" -eq 0 ]]; then
    killall -HUP mDNSResponder 2>/dev/null || true
    killall mDNSResponderHelper 2>/dev/null || true
  else
    log "[dry-run] killall -HUP mDNSResponder"
  fi
}

cmd_restore() {
  require_root "restore"
  [[ -d "$BASELINE_SERVICES" ]] || die "未找到基线备份，请先运行: sudo $SCRIPT_NAME backup"

  if [[ "$FORCE" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
    confirm "即将从基线恢复网络配置，是否继续？" || die "已取消"
  fi

  if [[ -f "$BASELINE_META" ]]; then
    # shellcheck disable=SC1090
    source "$BASELINE_META"
    log "基线时间: ${BACKUP_TIME:-未知}  主机: ${HOSTNAME:-未知}"
  fi

  restore_location

  local file
  shopt -s nullglob
  for file in "$BASELINE_SERVICES"/*.env; do
    restore_service_from_file "$file"
  done
  shopt -u nullglob

  restore_service_order
  restore_hosts
  flush_network_caches

  log "网络配置已从基线恢复。"
}

# --- 重置为系统默认 ---

reset_service_defaults() {
  local service="$1"
  log "重置服务为默认: $service"

  run_cmd_or_warn networksetup -setnetworkserviceenabled "$service" on
  run_cmd_or_warn networksetup -setdhcp "$service"
  run_cmd_or_warn networksetup -setv6automatic "$service"
  run_cmd_or_warn networksetup -setdnsservers "$service" Empty
  clear_search_domains "$service" || warn "无法清除 $service 的搜索域"
  run_cmd_or_warn networksetup -setwebproxystate "$service" off
  run_cmd_or_warn networksetup -setsecurewebproxystate "$service" off
  run_cmd_or_warn networksetup -setsocksfirewallproxystate "$service" off
  run_cmd_or_warn networksetup -setproxyautodiscovery "$service" off
  run_cmd_or_warn networksetup -setproxybypassdomains "$service" Empty
  run_cmd_or_warn networksetup -setadditionalroutes "$service"
  run_cmd_or_warn networksetup -setv6additionalroutes "$service"
}

cmd_reset() {
  require_root "reset"

  if [[ "$FORCE" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
    confirm "即将重置所有网络服务为系统默认（DHCP、无代理、无自定义 DNS），是否继续？" || die "已取消"
  fi

  local service
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    reset_service_defaults "$service"
  done < <(list_services)

  run_cmd networksetup -switchtolocation Automatic
  flush_network_caches
  log "网络配置已重置为系统默认。"
  log "提示: 如需恢复到特定历史状态，请先 backup 再 restore。"
}

# --- 状态对比 ---

print_service_summary() {
  local service="$1"
  local info dns proxy
  info="$(networksetup -getinfo "$service" 2>/dev/null || true)"
  dns="$(networksetup -getdnsservers "$service" 2>/dev/null || true)"
  proxy="$(networksetup -getwebproxy "$service" 2>/dev/null || true)"

  printf '\n[%s]\n' "$service"
  printf '  启用: %s\n' "$(networksetup -getnetworkserviceenabled "$service" 2>/dev/null || echo 未知)"
  printf '  IPv4: %s\n' "$(parse_ipv4_mode "$info")"
  printf '  IPv6: %s\n' "$(parse_ipv6_mode "$info")"
  printf '  DNS: %s\n' "$(tr '\n' ' ' <<<"$dns")"
  if grep -q "Enabled: Yes" <<<"$proxy"; then
    printf '  HTTP 代理: %s\n' "$(printf '%s' "$proxy" | awk -F': ' '/^Server:|^Port:/{printf $2" "} END{print ""}')"
  else
    printf '  HTTP 代理: 关闭\n'
  fi
}

cmd_status() {
  require_macos
  log "当前网络服务:"
  local service
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    print_service_summary "$service"
  done < <(list_services)

  printf '\n'
  if [[ -d "$BASELINE_SERVICES" ]]; then
    if [[ -f "$BASELINE_META" ]]; then
      # shellcheck disable=SC1090
      source "$BASELINE_META"
      log "基线备份: $BASELINE_DIR"
      log "  时间: ${BACKUP_TIME:-未知}"
      log "  主机: ${HOSTNAME:-未知}"
    else
      log "基线备份目录存在: $BASELINE_DIR"
    fi
    log "恢复命令: sudo $SCRIPT_NAME restore"
  else
    warn "尚未创建基线备份。建议先运行: sudo $SCRIPT_NAME backup"
  fi
}

# --- 主入口 ---

main() {
  require_macos

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    init_paths
    usage
    exit 0
  fi

  local cmd="${1:-restore}"
  shift || true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --force) FORCE=1 ;;
      --dir)
        shift
        [[ $# -gt 0 ]] || die "--dir 需要路径参数"
        DATA_DIR="$1"
        ;;
      -h|--help|help) usage; exit 0 ;;
      *) die "未知选项: $1" ;;
    esac
    shift
  done

  init_paths

  case "$cmd" in
    backup)  cmd_backup ;;
    restore) cmd_restore ;;
    reset)   cmd_reset ;;
    status)  cmd_status ;;
    help)    usage ;;
    *)
      die "未知命令: $cmd（运行 $SCRIPT_NAME help 查看帮助）"
      ;;
  esac
}

main "$@"
