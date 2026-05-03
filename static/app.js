const FEATURE_OUTPUT_IDS = {
  career: "outputCareer",
  analyze: "outputAnalyze",
  tailor: "outputTailor",
  interview: "outputInterview",
};

function getFeatureOutput(feature) {
  return $(FEATURE_OUTPUT_IDS[feature] || "output");
}

function setFeatureOutput(feature, text) {
  const target = getFeatureOutput(feature);
  if (target) target.textContent = text;
}

function getResumeJobDrafts() {
  const resume = (($("resume") && $("resume").value.trim()) || localStorage.getItem(DRAFT.resume) || "").trim();
  const job = (($("job") && $("job").value.trim()) || localStorage.getItem(DRAFT.job) || "").trim();
  return { resume, job };
}

const __analysisRunSeq = {};

async function callAnalysisApi(endpoint, body, feature = "main") {
  const runId = (__analysisRunSeq[feature] || 0) + 1;
  __analysisRunSeq[feature] = runId;
  setLoading(true);
  setStatus("正在分析，请稍候…", false);
  setFeatureOutput(feature, "正在分析中...");
  try {
    const result = await postJson(endpoint, body);
    if (__analysisRunSeq[feature] !== runId) return null;
    const payload = result && typeof result === "object" && result.data ? result.data : result;
    const normalized = normalizeResultData ? normalizeResultData(payload) : payload;
    const plainText = formatModelPlainText(normalized);
    setFeatureOutput(feature, plainText);
    setStatus("分析完成。", false);
    return normalized;
  } catch (err) {
    if (__analysisRunSeq[feature] !== runId) return null;
    const msg = "调用失败，请检查模型配置";
    setStatus(msg, true);
    setFeatureOutput(feature, msg);
    return null;
  } finally {
    if (__analysisRunSeq[feature] === runId) setLoading(false);
  }
}

async function runCareerPlan() {
  const { resume } = getResumeJobDrafts();
  const concern = (($("customConcern") && $("customConcern").value.trim()) || localStorage.getItem(DRAFT.customConcern) || "").trim();
  if (!resume) {
    setStatus("请先补充简历内容。", true);
    setFlowStep("resume");
    return null;
  }
  return callAnalysisApi("/api/v1/career-plan", { resume, concern, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "career");
}

async function runAnalyze() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/analyze", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "analyze");
}

async function runTailor() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/tailor", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "tailor");
}

async function runInterviewSim() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/interview", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "interview");
}
