# 部署指南

## 最快路径：Render（免费档，5 分钟）

1. 把仓库推到 GitHub；
2. Render → New → Web Service → 选仓库（自动识别 Dockerfile）；
3. 环境变量至少填：`DASHSCOPE_API_KEY`、`IMAGE_API_KEY`、`ACCESS_TOKEN`（`openssl rand -hex 16` 生成）；
4. 部署完成得到 `https://xxx.onrender.com`，把网址 + token 发给使用者。
   免费档 15 分钟无访问会休眠，首次打开慢十几秒。

## 自有服务器（Docker）

```bash
docker build -t outfit .
docker run -d -p 8787:8787 --env-file .env --restart unless-stopped outfit
```

HTTPS 用 Caddy 一行反代：

```
你的域名 {
  reverse_proxy 127.0.0.1:8787
}
```

必须 HTTPS：工具会上传用户全身照。

## 环境变量清单

| 变量 | 必填 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | 出真实试衣图必填 | 阿里云百炼（北京地域） |
| `IMAGE_API_KEY` | 搭配师/质检/兜底必填 | 硅基流动 |
| `ACCESS_TOKEN` | 公网部署必填 | 不设则 API 仅本机可调 |
| `PORT` | 可选 | 默认 8787 |
| `ALLOWED_ORIGINS` | 有第三方前端接入时填 | CORS 白名单，逗号分隔 |
| `DAILY_BUDGET_YUAN` / `TRYON_UNIT_YUAN` | 可选 | 全局预算闸，默认 50 元/日、0.5 元/次 |
| `TRYON_DAILY_PER_IP` | 可选 | IP 每日软配额，默认 30（只提示不拦） |
| `STYLIST_ALLOW_OUTER` | 可选 | 外套轮实测不达标设 0 |
| `STYLIST_MODEL` / `QC_MODEL` | 可选 | 默认 Qwen2.5-7B / Qwen2.5-VL-32B |
| `ALERT_WEBHOOK` | 可选 | 企业微信机器人，降级率/P95 超阈告警 |
| `RELAY_HOST_SUFFIXES` | 可选 | 图片中转域名白名单 |

## 限制与已知边界（部署前必读）

- **进程内状态**：限流、熔断、预算闸、配额、降级率统计全部是**单进程内存态**。多实例/自动扩缩容部署时各实例独立计数，熔断与预算会失效——需要多实例时先把这几项迁到 Redis 或共享存储；
- 日志（AI 调用打点、beacon、告警）走 stdout，由托管平台收集与轮转，本服务不写磁盘文件；
- 试衣结果 URL 直传（浏览器直拉百炼签名 URL），URL 有时效；客户端已在生成完成时把结果存入浏览器 IndexedDB；
- 隐私：用户照片与生成结果不在本服务端落盘；服务商侧数据政策见其官方条款，上线前确认已选"不留存/不训练"服务档，并在页面隐私说明中告知用户。

## 上线前检查单

- [ ] `.env` 已填 key 且 `ACCESS_TOKEN` 已设置
- [ ] HTTPS 可用
- [ ] 跑过 `tests/calibration.md` 的 10 次实测并完成校准
- [ ] `STYLIST_ALLOW_OUTER` 按实测结果设置
- [ ] 页面隐私说明已确认与所选服务商档位一致
