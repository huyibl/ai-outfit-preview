# HTTP API v1

所有接口同源挂在网页服务下（dev 由 Vite middleware 提供，生产由 `npm run start` 的独立服务提供）。

## 鉴权

- 服务端设置 `ACCESS_TOKEN` 后，除探测接口外的所有请求需带 `Authorization: Bearer <ACCESS_TOKEN>`。
- 未设置 `ACCESS_TOKEN` 时仅允许本机（127.0.0.1 / ::1）调用。
- 可选 BYOK：请求头 `X-Upstream-Key: <你的百炼Key>` 可覆盖服务端配置的 key（仅 tryon 生效于百炼，图像接口同理）。

## 限流（服务端内置，按 IP/令牌）

| 接口 | 上限 |
| --- | --- |
| 生成类 POST | 10 次/分钟 |
| 虚拟试衣 POST | 4 次/分钟 |
| 单请求体 | ≤ 8MB |

超限返回 `429`，响应头带 `Retry-After`（秒）。

## GET /api/v1/capabilities

能力探测（无需鉴权场景下的本机默认可用）。

```json
{ "configured": true, "tryon": true, "image": false }
```

## POST /api/v1/preview

`Content-Type: application/json`。三种模式：

### 虚拟试衣（mode=tryon）

```json
{
  "mode": "tryon",
  "person": "data:image/jpeg;base64,...",
  "top": "data:image/png;base64,...",
  "bottom": "data:image/png;base64,...(可选)"
}
```

返回 `{ "image": "data:image/jpeg;base64,...", "source": "tryon" }`。
`person` 必填；`top`/`bottom` 至少一个。图片支持 dataURL 或 https URL。

### 图生图（mode=img2img）

```json
{ "mode": "img2img", "prompt": "…", "negativePrompt": "…", "image": "data:…", "image2": "data:…(可选)", "image3": "data:…(可选)" }
```

### 文生图（mode=txt2img 或省略 mode）

```json
{ "prompt": "…" }
```

## 错误格式（v1）

```json
{ "error": { "code": "bad_request", "message": "缺少 prompt", "field": "prompt" } }
```

| code | HTTP | 含义 |
| --- | --- | --- |
| bad_request | 400 | 参数缺失/非法 |
| unauthorized | 401 | 缺少或错误的访问令牌 |
| not_found | 404 | 路径不存在 |
| method_not_allowed | 405 | HTTP 方法不支持 |
| payload_too_large | 413 | 请求体超过 8MB |
| rate_limited | 429 | 触发限流 |
| tryon_degraded | 503 | 试衣熔断开路：服务端已判定百炼不可用，前端应立即走兜底链路 |
| not_configured | 501 | 服务端未配置对应上游 Key |
| upstream_failed | 502 | 上游（百炼/硅基流动）返回错误 |
| tryon_timeout | 504 | 试衣轮询超时（约 120 秒） |

> 兼容：旧路径 `/api/preview` 保留，错误为字符串格式 `{ "error": "…" }`；新接入请使用 v1。

## 降级与配额头（tryon 响应）

- `X-Quota-Notice: ip-daily-soft`：该 IP 今日试衣次数超过软配额（`TRYON_DAILY_PER_IP`，默认 30），仍会处理；
- 客户端最终降级级别以适配层结果为准（`degradedLevel: "qwen" | "collage"`），并通过 `POST /api/v1/beacon` 回流（body ≤2KB，每 IP 30 次/分，前端每分钟最多采样 1 条）；
- 三级降级链：百炼试衣（熔断保护）→ Qwen 图生图（轻量计数）→ 本地拼贴（永远可用）。

## CORS

设置 `ALLOWED_ORIGINS=https://a.example,https://b.example`（逗号分隔）后，这些来源的浏览器可直接跨域调用；支持 OPTIONS 预检。

## iframe 嵌入

`<iframe src="https://你的部署/?embed=1" />` 加载精简界面（无顶栏，衣橱隐藏，仅搭配+出图）。宿主通过 postMessage 通信：

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 嵌入页 → 宿主 | `{type:"outfit-preview:ready"}` | iframe 加载完成 |
| 宿主 → 嵌入页 | `{type:"outfit-preview:set-items", items:[{dataUrl, name?, category?}]}` | 预置衣物；category ∈ top/bottom/dress/outerwear/shoes/accessory/bag |
| 嵌入页 → 宿主 | `{type:"outfit-preview:result", url, source}` | 每次生成成功后推送，source 为 `"api"` 或 `"mock"` |


## POST /api/v1/stylist（AI 搭配师）

```json
{
  "intent": "秋天通勤显干净",
  "sceneTags": ["work"],
  "outfitCount": 3,
  "wardrobe": [{ "id": "t1", "category": "top", "color": "白", "style": "极简", "season": "all", "occasion": "all" }],
  "preference": "喜欢：极简×5 | 不喜欢：正式×4"
}
```

返回 `{ "outfits": [{ "styleName", "occasion", "itemIds", "reason", "styleTags" }], "wardrobeGaps": ["…"], "mode": "llm" | "rule" | "inspire" }`。

- 衣橱只传元数据不传图；`wardrobe` 为空时返回 `mode:"inspire"`；
- LLM 不可用/输出非法时自动降级规则引擎（`mode:"rule"`），配半开熔断恢复；
- 缓存 key 含偏好摘要，偏好变化自动失效；限流 20 次/分。

## POST /api/v1/qc（生成质检）

`{ "resultUrl?": "https://…", "resultDataUrl?": "data:…", "baseDataUrl?": "data:…", "garmentHint?": "白衬衫（白色）" }`
返回 `{ "pass", "face", "body", "garment", "edge" }`。四问逐项判定，不合格需两次一致；QC 服务故障时放行。

## POST /api/v1/tag（导入自动打标）

`{ "imageDataUrl": "data:…" }` → `{ "style?", "material?", "fit?", "pattern?" }`。

## POST /api/v1/relay-image（图片中转，SSRF 防护）

`{ "url": "https://…" }` → `{ "image": "data:…" }`。仅 https + 域名后缀白名单（`RELAY_HOST_SUFFIXES`）+ 拒绝私网 IP（含 DNS 解析后）+ ≤8MB + 必须 image/*；限流 10 次/分。

## 试衣直传与预算

- `POST /api/v1/preview`（mode=tryon）v1 响应改为 `{ "imageUrl": "https://…" }`（时效签名 URL，浏览器直拉，省服务器带宽）；legacy 路径保持返回 dataURL。前端直拉失败可调 relay-image 兜底。
- 预算闸：`DAILY_BUDGET_YUAN`（默认 50 元/日）按 `TRYON_UNIT_YUAN`（默认 0.5 元/次）计费，超限返回 `429 { code: "budget_exhausted" }`；`0` 关闭。
- 三件同穿能力探测：请求可带 `outer`；服务端先尝试 `outer_garment_url`，参数错误则永久回退两轮，服务端错误不缓存结论。

## 本地开发 / 部署

```bash
npm run dev     # 开发（http://localhost:5173）
npm run build   # 类型检查 + 打包
npm run start   # 生产：单进程托管 dist/ + API（默认端口 8787，PORT 可改）
npm test        # 单测 + API 契约测试
```
