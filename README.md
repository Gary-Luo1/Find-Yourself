# Find Yourself

`Find Yourself` 是一款面向求职者的 AI 求职伴侣，围绕“陪聊、陪看、陪想、陪记”四个阶段组织求职流程，帮助用户更清楚地认识自己、更准确地理解岗位，并把分析结论落实为持续行动。

## 产品定位

它不是一个单纯的简历工具，也不是一次性问答机器人，而是一个覆盖求职全流程的陪伴式产品。核心目标是：

- 帮用户把求职困惑说清楚
- 帮用户把简历、目标岗位和个人能力放在一起看
- 帮用户把分析结果转成可执行的行动计划
- 帮用户持续记录、筛选、复盘与推进求职进展

## 当前功能

### 1. 陪聊

- 通过开放式对话了解用户的目标、顾虑和时间线
- 支持聊天记忆、用户画像、状态更新
- 支持悬浮聊天入口，方便在其他页面随时提问
- 可配置模型服务，支持本地直连或后端统一调用

### 2. 陪看

- 输入或粘贴简历内容
- 输入目标岗位 JD
- 支持 PDF / DOCX 文本提取
- 支持草稿保存与继续编辑
- 作为后续分析的输入基础

### 3. 陪想

提供四类分析能力：

- 职业方向与行动计划
- 岗位匹配分析
- 简历润色
- 面试模拟

其中：

- 职业方向与行动计划用于做方向判断、能力差距识别与分阶段行动设计
- 岗位匹配分析用于对简历和 JD 做结构化匹配
- 简历润色用于输出更贴近目标岗位的表达
- 面试模拟用于生成定制化题目、回答思路和准备建议

### 4. 陪记

- 以表格形式记录求职旅程
- 支持岗位链接、投递时间、面试轮次、当前状态、备注等字段
- 支持搜索、筛选、编辑、删除和导出 CSV
- 支持状态统计卡，方便快速查看求职进展
- 适合长期跟踪投递、面试与 offer 状态

## 页面结构

- `index.html`：首页入口
- `chat.html`：陪聊
- `resume.html`：陪看
- `analyze.html`：陪想
- `journey.html`：陪记
- `settings.html`：模型配置页面

## 技术栈

- Python + FastAPI
- 原生 HTML / CSS / JavaScript
- SSE 流式聊天
- PDF / DOCX 文本提取
- Word 导出
- 浏览器本地存储（草稿、记忆、求职记录）

## 数据与记忆

系统会在浏览器本地保存一些状态，例如：

- 对话记录
- 草稿内容
- 用户画像
- 求职旅程记录
- 情绪与阶段状态

后端也支持按 `client_id` 保存记忆数据，用于连续对话和画像更新。

## 公网部署

推荐使用 **Railway + Vercel**：

- Railway：部署 FastAPI 后端
- Vercel：部署静态前端
- Vercel 通过 `/api/*` rewrite 访问 Railway 后端

### Railway 后端

项目已提供 `railway.json` 与 `Procfile`，可直接部署。

部署步骤：

1. 在 Railway 新建项目并连接本仓库
2. 保持默认 `NIXPACKS` 构建（已在 `railway.json` 配置）
3. 启动命令使用：`python -m uvicorn main:app --host 0.0.0.0 --port ${PORT}`
4. 部署完成后获取后端域名（如 `https://xxx.up.railway.app`）

Railway 环境变量至少需要配置：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（默认可用 `https://api.openai.com/v1`）
- `OPENAI_MODEL`
- `APP_ENV=production`
- `CORS_ALLOW_ORIGINS=https://你的Vercel域名.vercel.app`
- `EXPOSE_API_DOCS=false`

### Vercel 前端

项目已提供 `vercel.json`，请把其中 `/api/:path*` 的 `destination` 改为你的 Railway 域名，例如：

```json
{ "source": "/api/:path*", "destination": "https://xxx.up.railway.app/api/:path*" }
```

其余规则已就绪：

- `/chat`、`/resume`、`/analyze`、`/journey`、`/settings` 会转到对应静态页面
- `/static/*` 会正常访问静态资源
- `/` 会转到 `index.html`

部署到 Vercel 后，前端可直接通过同域 `/api/*` 调用后端。

## 运行方式

### Windows 一键启动

在项目根目录执行：

```powershell
.\run.ps1
```

脚本会自动：

- 创建虚拟环境（如不存在）
- 安装依赖
- 启动服务

### 手动启动

1. 复制 `.env.example` 为 `.env` 并填写模型配置。
2. 安装依赖：

```bash
pip install -r requirements.txt
```

3. 启动服务：

```bash
uvicorn main:app --reload
```

4. 打开页面：

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/chat.html`

## 环境变量

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `APP_ENV`
- `CORS_ALLOW_ORIGINS`
- `EXPOSE_API_DOCS`
- `MAX_UPLOAD_BYTES`

## 目录结构

- `main.py`：后端 API 与页面路由
- `static/`：前端静态资源
- `data/`：运行时数据与记忆
- `tests/`：自动化测试
- `scripts/`：辅助脚本

## 说明

这份 README 描述的是当前代码对应的产品状态。它强调四个核心阶段：

- 陪聊：明确诉求
- 陪看：整理材料
- 陪想：分析方向
- 陪记：推进与复盘
