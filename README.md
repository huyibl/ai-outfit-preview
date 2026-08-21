# 🧥 AI 穿搭预演工具

把衣柜里的单品拖到搭配区，一键生成全身穿搭预览：默认本地秒出图，填入 API Key 后可走 **文生图（免费）** 或 **图生图（约 ¥0.30/张）**。适合课程演示与个人衣橱试验，而不是精确虚拟试衣。

**AI Outfit Preview** — Drag wardrobe items onto a canvas and generate a full-body look. Local collage is the default (fast, free, offline); a real image API is optional after you paste a key. Built for demos and personal experiments, not pixel-perfect virtual try-on.

---

## 🎬 演示视频

操作演示（文生图 + 图生图）：[Bilibili BV1Kv8K6BE3F](https://www.bilibili.com/video/BV1Kv8K6BE3F/)

本地也可再录一份：`npm run demo:video` 会生成 `demo/ai-outfit-demo.webm`（体积较大，不纳入 Git）。

演示流程：加载示例衣橱 → 女模 → 红大衣 / 灰裙 / 白鞋 / 黑包 → 文生图出图 → 切换图生图再出图 → 保存套装 → 导出备份。

---

## 📖 功能讲解

页面是三栏布局：**衣橱 | 搭配 | 套装**。

### 衣橱（左）

- 内置 6 件示例单品（红大衣、橙夹克、格纹外套、灰裙、白鞋、黑包），刷新页面仍在（浏览器本地存储）。
- 顶部搜索、品类 / 季节 / 场合筛选。
- 「+」或顶栏「添加衣服」支持 **一次选多张照片**；文件名会尝试猜品类（例如文件名含「裙」→ 连衣裙）。
- 卡片上的「添加」把单品放进中间搭配区；「编辑」改名称、颜色、季节等。
- 顶栏「导入备份 / 导出备份」是整库 JSON，方便交作业或换电脑。

### 搭配（中）

- 从左栏拖到中栏，或点「添加」。
- 同品类会互相替换（两件外套只留一件）。
- 连衣裙与上下装互斥：上了裙子会拿掉分开的上衣/裤子，反之亦然。
- 「保存套装」把当前单品 + 预览图存到右栏历史。

### 套装（右）

- **模特**：自动 / 女模 / 男模。选「自动」时，画布上有裙或连衣裙会偏向女模。
- **文生图**（默认）：按单品文字描述调用 `Kwai-Kolors/Kolors`，竖构图全身写真，**免费**。不锁定某一张底图，所以每次脸和姿势可能不同，但更像完整穿搭照。
- **图生图**：把固定女模/男模底图和单品拼成参考板，调用 `Qwen/Qwen-Image-Edit`，尽量保持同一模特身份。需要硅基流动账户 **有余额**（大约 ¥0.30/张）。
- 没有 `IMAGE_API_KEY` 时，两种模式都退回 **本地 Canvas 拼贴**（单品贴在人台上），保证没网也能录演示。
- 预览下方会标明这次是「AI 接口」还是「本地合成」。

### 这不是虚拟试衣

不会把衣服抠图对齐到真人照片上。文生图追求「看起来像一套全身穿搭写真」；图生图追求「同一张模特底图 + 单品参考」。单品纹理不保证逐像素一致。

---

## ✨ 核心功能

- 👕 **衣柜管理**：搜索、品类/季节/场合筛选，添加、编辑、备份导入导出，数据留在浏览器本地。
- 🖱️ **拖拽搭配**：左栏拖到中栏即可组套；同品类自动替换，连衣裙与上下装互斥。
- ⚡ **双路径出图**：无 Key 时本地拼贴；有 Key 时可选免费文生图或付费图生图。
- 💾 **套装存档**：保存当前搭配与预览图，方便对比和录屏。
- 🔒 **零账号**：不登录、不上传衣橱到第三方（走本地合成时）。走 API 时只会把参考板/提示词发到你配置的图像服务。

**Core features**

- 👕 Wardrobe: search, filters, add/edit, JSON backup — all in the browser.
- 🖱️ Drag-and-drop canvas with category replacement rules.
- ⚡ Dual render path: local collage, or text-to-image / image-to-image.
- 💾 Saved outfits for comparison and screen recording.
- 🔒 No accounts; images stay local unless you opt into a remote image API.

### 为什么是「本地合成 + 可插拔 API」

课程/演示要的是「打开就能点完一遍」。若强制绑定某一家出图服务，没 Key、欠费或网络不通就会录不成视频。把规则拼 prompt、本地拼贴作为默认路径，把真实 API 做成可选插件，能同时满足「能交作业」和「能展示 AI 出图」。

**Why this design**

A demo must survive missing keys and flaky networks. Prompt assembly plus a local collage keeps the happy path offline; the image API is a switch, not a gate.

### 性能与成本对比（本机实测口径）

| 路径 | 典型时延 | 费用 | 网络 | 观感 | 适用 |
| --- | --- | --- | --- | --- | --- |
| 本地 Canvas 合成 | 约 0.5–2 秒 | 免费 | 不需要 | 单品贴在人台上 | 录作业、调交互 |
| SiliconFlow Kolors（文生图） | 约 3–8 秒 | 免费额度 | 需要 | 全身写真风格 | 课堂展示 AI |
| SiliconFlow Qwen-Image-Edit（图生图） | 约 8–20 秒 | 约 ¥0.30/张 | 需要且账户有余额 | 更贴近固定模特 | 展示参考图编辑 |
| OpenAI DALL·E 3 | 约 8–20 秒 | 按次，相对高 | 需要（国内常需代理） | 细节更稳、更贵 | 有官方 Key 时 |

端到端自动演示（Playwright，含搜索/搭配/文生图/图生图/导出）约 1–3 分钟（取决于 API）。真实 API 的精确单价与 SLA 以服务商控制台为准。更大规模压测数据：[待补充]。

**Performance (indicative)**

Local collage: ~0.5–2s, free, offline. Kolors txt2img: ~3–8s, free quota. Qwen-Image-Edit img2img: ~8–20s, ~¥0.30/image. DALL·E 3: ~8–20s, higher unit cost. Playwright dual-mode demo: ~1–3 min depending on the API.

---

## 🚀 快速开始

需要已安装 **Node.js 20+**（安装包请勾选 Add to PATH）。不会配环境变量时，按下面做即可。

1. 打开终端，进入项目并安装依赖：

```bash
cd ai-outfit-preview
npm install
npm run dev
```

2. 浏览器打开提示的地址（一般是 http://localhost:5173 ）。不填任何密钥也能生成预览（本地合成）。

3. 若要真实 AI 出图：复制 `.env.example` 为 `.env`，只改这一行，把 Key 粘贴到等号后面，保存：

```
IMAGE_API_KEY=这里粘贴密钥不要加引号
```

国内推荐到 [硅基流动](https://cloud.siliconflow.cn) 创建密钥；默认已经写好地址和模型。保存后回到页面再点一次「生成穿搭预览」即可（不必关终端）。右侧若写着「文生图 · Kolors 免费」，成功出图后预览下方会显示「AI 接口」。图生图需要账户里有余额。

4. 录操作演示（需本机已 `npx playwright install chromium`）：

```bash
npm run demo:video
```

会写出 `demo/ai-outfit-demo.webm`。当前演示已上传：[Bilibili BV1Kv8K6BE3F](https://www.bilibili.com/video/BV1Kv8K6BE3F/)。

**Quick start**

Install Node.js 20+ with Add to PATH. Then `npm install` and `npm run dev`. Open http://localhost:5173. For real images, copy `.env.example` to `.env`, set `IMAGE_API_KEY`, save, and click generate. Img2img needs a funded SiliconFlow account. Record with `npm run demo:video`.

---

## 🧩 技术栈

| 层 | 选型 | 版本要求 | 选择原因 |
| --- | --- | --- | --- |
| 运行 | Node.js | **20+**（开发时用过 22 / 24） | 一条 `npm` 命令即可 |
| 构建 / 页面 | Vite 7、React 19、TypeScript 5.9 | 浏览器即可 | 热更新快，适合改 UI |
| 拖拽 | 原生 HTML5 DnD | 无额外库 | 依赖少、演示稳 |
| 存储 | localStorage + IndexedDB | 现代 Chrome / Edge | 图比 JSON 大，避免撑爆配额 |
| 出图 | 本地 Canvas；可选 OpenAI 兼容 `images/generations` 与 `images/edits` | 有 Key 才走网络 | 默认路径不绑厂商 |
| 录屏 | Playwright 1.55 | 可选 | `npm run demo:video` 产出 WebM |

不引入后端框架、数据库或登录。生产静态部署时若没有 `/api/preview` 进程，会自动只用本地合成。

**Stack**

Node.js 20+, Vite 7, React 19, TypeScript 5.9, native drag-and-drop, localStorage + IndexedDB, optional OpenAI-compatible image API, Playwright for the demo video. No app server or database. Static hosts without the preview middleware fall back to collage.

---

## 🔑 API 参考或配置说明

只需要关心 `.env` 里这几项（Key 只给本机开发服务器读取，不会打进前端包，也 **不要提交到 Git**）：

| 参数 | 作用 | 默认 / 示例 |
| --- | --- | --- |
| `IMAGE_API_KEY` | 图像服务令牌。空 = 本地合成 | 空 |
| `IMAGE_API_BASE` | 接口根路径 | `https://api.siliconflow.cn/v1` |
| `IMAGE_TXT_MODEL` | 文生图模型 | `Kwai-Kolors/Kolors`（免费） |
| `IMAGE_EDIT_MODEL` | 图生图模型 | `Qwen/Qwen-Image-Edit`（约 ¥0.30） |

OpenAI 时改为 `IMAGE_API_BASE=https://api.openai.com/v1`。完整 REST 字段与计费见各服务商文档。

**Config**

`IMAGE_API_KEY` (empty → mock), `IMAGE_API_BASE` (SiliconFlow v1), `IMAGE_TXT_MODEL` / `IMAGE_EDIT_MODEL`. Never commit `.env`.

---

## 🤝 贡献指南与许可证

欢迎 Issue / PR。请保持「无 Key 也能跑通演示」这条底线：新功能不要把真实 API 变成硬依赖。提交前在本地执行 `npm run build`；若改了主流程，建议再跑 `npm run demo:video`。

**下一步优化方向** 🛠️

1. 可把 `public/models/` 换成自己的写真底图，提高图生图真实感。
2. 将 `/api/preview` 做成独立小服务，便于静态托管时仍能出图。
3. 增加简单搭配规则（季节冲突、色彩对比）再调用模型。
4. 正式压测与单次成本表：[待补充]。

许可证：[MIT](LICENSE)。

**Contributing & license**

Issues/PRs welcome. Keep the no-key demo path working. Run `npm run build` before a PR; re-record `npm run demo:video` if the main flow changes. Licensed under MIT.
