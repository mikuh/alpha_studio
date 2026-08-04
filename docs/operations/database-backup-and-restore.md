# 数据库备份与恢复

Alpha Studio 服务端 PostgreSQL 必须每天备份。桌面端本地 SQLite 已有独立的每日/月度备份，本说明只覆盖服务端数据库。

## 备份

```bash
npm run ops:db-backup
```

脚本使用 PostgreSQL custom format 生成备份、执行 `pg_restore --list` 完整性检查、设置文件权限为 `0600`，并输出 SHA-256。默认写入 Git 忽略的 `backups/postgres/`；生产环境应把目录指向加密对象存储的挂载点。

建议策略：每日备份保留 30 天、每月备份保留 12 个月；至少一份副本位于不同故障域。备份包含客户授权、Token 用量、账本和密文凭据，因此访问权限应等同生产数据库。

## 隔离恢复演练

```bash
npm run ops:db-restore-drill -- backups/postgres/alpha-studio-YYYYMMDDTHHMMSSZ.dump
```

演练只创建名称为 `alpha_restore_drill_*` 的临时数据库，验证迁移表、客户表和账本后自动删除临时数据库，不覆盖当前数据库。

生产环境至少每季度执行一次演练并记录：备份时间、文件校验值、恢复耗时、验证结果、执行人和异常处置。真正灾难恢复前应先停止写流量，保留故障库快照，再由两人复核目标数据库与备份文件。
