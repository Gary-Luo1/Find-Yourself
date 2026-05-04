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

当前更适合先使用 **阿里云 ECS + 直连公网 IP** 的方式上线，确认功能可用后，再按需要切换到域名、HTTPS、Vercel 或其他前端托管方案。

### Windows ECS 快速上线

如果你的阿里云服务器是 Windows 系统，可以直接把整个项目放到服务器上运行 FastAPI：

1. 将项目解压到服务器，例如：`C:\Users\Administrator\resume-matcher\resume-matcher`
2. 安装 Python 3.10+、Git（可选）
3. 进入项目目录，创建虚拟环境：

```powershell
cd C:\Users\Administrator\resume-matcher\resume-matcher
python -m venv .venv
```

4. 安装依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

5. 设置环境变量：

```powershell
$env:OPENAI_API_KEY="你的key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="你的模型名"
$env:APP_ENV="production"
$env:CORS_ALLOW_ORIGINS="http://127.0.0.1:8000"
$env:EXPOSE_API_DOCS="false"
$env:MAX_UPLOAD_BYTES="10485760"
```

6. 启动服务：

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

7. 在阿里云安全组和 Windows 防火墙中放行 `8000` 端口
8. 通过公网 IP 访问：`http://你的公网IP:8000/`

### 阿里云部署注意事项

- `uvicorn` 必须监听 `0.0.0.0`，不能只监听 `127.0.0.1`
- 阿里云安全组需要放行对应端口（测试阶段至少放行 `8000`）
- Windows 防火墙也需要允许入站 `8000` 端口
- 如果你希望更正式，可以后续再加域名、HTTPS 和 80/443 端口反代

### 以后如果切换到 Vercel + 后端分离

如果你后续想把前端放到 Vercel、后端继续放在 ECS 或其他平台，可以保留下面这类架构：

- 后端：FastAPI API 服务
- 前端：Vercel 静态页面
- 通过 `/api/*` 或前端配置的 API Base URL 访问后端

这种方式适合更正式的生产环境，但不如 Windows ECS 直连公网 IP 上线快。

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
