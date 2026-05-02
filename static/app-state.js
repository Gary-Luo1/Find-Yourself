const LS = {
  key: "rm_api_key",
  base: "rm_base_url",
  model: "rm_model",
  rememberKey: "rm_remember_key",
};
const SS = {
  key: "rm_api_key_session",
};
const DRAFT = {
  resume: "rm_draft_resume",
  job: "rm_draft_job",
  jobMulti: "rm_draft_job_multi",
  concernChecks: "rm_draft_concern_checks",
  customConcern: "rm_draft_custom_concern",
};
const MULTI_JD_IDS = ["jobMulti1", "jobMulti2", "jobMulti3", "jobMulti4", "jobMulti5"];
const MIN_MULTI_JD_VISIBLE = 1;
const HISTORY_KEY = "rm_recent_runs_v1";
const HISTORY_LIMIT = 8;
const JOURNEY_KEY = "rm_journey_board_v1";
const JOURNAL_KEY = "rm_reflection_log_v1";
const EMOTION_KEY = "rm_emotion_log_v1";
const CHAT_KEY = "rm_chat_thread_v1";

function $(id) {
  return document.getElementById(id);
}

function getApiBaseUrl() {
  const runtime = typeof window !== "undefined" ? window.__API_BASE_URL__ : "";
  const env = typeof process !== "undefined" && process.env ? process.env.API_BASE_URL : "";
  return String(runtime || env || localStorage.getItem("rm_api_base_url_override") || "").trim().replace(/\/$/, "");
}

function apiPath(path) {
  const clean = String(path || "");
  const base = getApiBaseUrl();
  if (!base) return clean;
  return `${base}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

function getPlatformHint() {
  return {
    vercel: Boolean((window.location.hostname || "").includes("vercel")),
    render: Boolean((window.location.hostname || "").includes("onrender")),
  };
}

/** 导出 .docx 时的建议文件名（不含扩展名） */
let lastExportBasename = "resume-matcher-export";
let lastRenderedPlainText = "";
let activeController = null;
const REQUEST_TIMEOUT_MS = 120000;
let resultCardSeq = 0;
let draftSaveTimer = null;
let lastRequest = null;
let lastTailorSourceResume = "";
let lastRunLabel = "";
const DEMO_RESUME = `张三
电话：138-0000-0000  邮箱：zhangsan@example.com

## 个人简介
3 年数据分析与增长运营经验，擅长 SQL、Python、A/B 测试与可视化，支持业务决策与转化提升。

## 工作经历
2023.03 - 至今  某互联网公司  数据分析师
- 搭建核心漏斗看板，统一口径后周会对齐效率提升约 30%。
- 主导注册流程优化实验，首周转化率提升 12.4%。
- 与产品/运营协作优化召回策略，月留存提升 4.1%。

2021.07 - 2023.02  某电商平台  运营分析
- 负责活动复盘与人群分层策略，推动复购率提升 8%。
- 建立日报自动化流程，手工报表时间从 2 小时降至 15 分钟。

## 技能
Python, SQL, Tableau, Excel, A/B Testing, FastAPI`;

const DEMO_JOB = `岗位：数据分析师（增长方向）

职责：
1. 负责用户增长相关指标体系搭建与监控；
2. 通过 SQL/Python 进行数据提取分析，输出可执行建议；
3. 与产品、运营、研发协作，推动增长实验落地；
4. 建立可视化看板，跟踪核心漏斗和留存指标。

要求：
- 2 年以上数据分析经验；
- 熟悉 SQL、Python，具备 A/B 测试经验；
- 具备业务理解和跨团队沟通能力；
- 加分项：有电商/互联网增长经验。`;

const DEMO_MULTI_JD = `岗位A：增长数据分析师
要求：SQL、Python、A/B 测试、漏斗分析、看板建设、跨团队协作。
---
岗位B：商业分析师
要求：数据建模、业务洞察、可视化汇报、策略评估、ROI 分析。
---
岗位C：用户运营分析师
要求：用户分层、留存分析、活动复盘、实验设计、沟通推进。`;
