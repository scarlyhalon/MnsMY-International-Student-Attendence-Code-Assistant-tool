import { createRecordStore, recordKey, mergeScan } from "./store.js";
import { createBrowserAdapter } from "./browser.js";
import { createDemoAdapter } from "./demo.js";
import { buildWeeks } from "./weeks.js";

const $ = id => document.getElementById(id);
const demo = location.protocol !== "chrome-extension:";
const adapter = demo ? createDemoAdapter() : createBrowserAdapter();
const drafts = new Map(); // Attendance codes stay in this page's memory only.
const recordStore = createRecordStore(demo ? {
  async get(key) { return { [key]: JSON.parse(localStorage.getItem(key) || "null") }; },
  async set(values) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
} : chrome.storage.local);
let settings = { startDate: "", weekCount: 12, breakStart: "", includePass: false };
async function saveRecord() { if (schedule) await recordStore.save(recordKey(schedule), schedule, outcomes); }
function renderRate() {
  const rate = schedule?.overallRate;
  $("overall-rate").textContent = typeof rate === "number" ? `${rate}%` : "暂未读取";
  $("overall-rate").style.color = typeof rate === "number" && rate < 80 ? "#c62828" : "";
  $("rate-help").hidden = !(typeof rate === "number" && rate < 80);
}
let schedule = null;
let outcomes = {};
let model = null;
let busy = false;
let rendered = false;
const symbols = { pending: "?", unavailable: "×", success: "✓", empty: "–" };
const dateLabel = date => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short"
}).format(new Date(`${date}T12:00:00Z`));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function status(title, text, state = "info") {
  $("status-title").textContent = title;
  $("status-text").textContent = text;
  $("status").dataset.state = state;
}
function setSettingsFields() {
  $("start-date").value = settings.startDate;
  $("week-count").value = settings.weekCount;
  $("break-start").value = settings.breakStart;
  $("include-pass").checked = Boolean(settings.includePass);
}
async function saveSettings() {
  if (demo) localStorage.setItem("attendance-helper-calendar-v2", JSON.stringify(settings));
  else await chrome.storage.local.set({ calendar: settings });
}
function selectedRows() {
  return model?.weeks.flatMap(week => week.rows).filter(row => row.canSubmit && drafts.get(row.key)?.trim()) || [];
}
function updateControls() {
  $("connect").disabled = busy;
  $("refresh").disabled = busy || !schedule;
  $("save-settings").disabled = busy;
  for (const id of ["start-date", "week-count", "break-start", "include-pass"]) $(id).disabled = busy;
  for (const input of document.querySelectorAll("input[data-key]")) {
    input.disabled = busy || input.dataset.available !== "true";
  }
  const count = selectedRows().length;
  $("submission-count").textContent = `已填写 ${count} 节课的签到码`;
  $("submit-all").disabled = busy || !count;
  $("submit-all").textContent = busy ? "正在逐节提交…" : `提交已填写的签到码${count ? ` (${count})` : ""}`;
}
function stateBadge(state, text, className) {
  const badge = element("span", className);
  badge.dataset.state = state;
  badge.append(element("span", "status-icon", symbols[state] || "?"), element("span", "", text));
  return badge;
}
function renderWeeks() {
  const open = new Set(Array.from($("weeks").querySelectorAll("details[open]"), item => Number(item.dataset.week)));
  $("weeks").replaceChildren();
  if (!settings.startDate || !schedule) {
    model = null;
    $("weeks").append(element("div", "empty-week", schedule ? "请设置学期开始日期，再生成每周课表。" : "连接学校签到网页后，这里会按教学周显示固定课表。"));
    $("summary").textContent = "等待连接课表";
    updateControls();
    return;
  }
  try { model = buildWeeks(schedule, settings, outcomes); }
  catch (error) {
    model = null;
    status("请检查学期设置", error.message, "error");
    updateControls();
    return;
  }
  const allRows = model.weeks.flatMap(week => week.rows);
  const validKeys = new Set(allRows.filter(row => row.canSubmit).map(row => row.key));
  for (const key of drafts.keys()) if (!validKeys.has(key)) drafts.delete(key);
  $("summary").textContent = `${model.weeks.length} 个教学周 · 每周 ${model.templateCount} 节课 · ${allRows.filter(row => row.canSubmit).length} 节可填写`;
  $("range-note").textContent = model.range.start
    ? `学校日期范围：${model.range.start} — ${model.range.end}。签到截止：下一周同一天、同一上课时间（马来西亚时间）。${settings.breakStart ? ` Mid break：从 ${settings.breakStart} 起 7 天，不计入教学周。` : ""}`
    : "尚未读取到学校开放的日期范围。";
  let preferred = model.weeks.find(week => week.rows.some(row => row.canSubmit))?.number;
  if (!preferred) preferred = model.weeks.find(week => !week.isPast)?.number;
  for (const week of model.weeks) {
    const section = element("details", "week-card");
    section.dataset.week = week.number;
    const missingHistory = !week.rows.length && week.isPast;
    const unavailable = missingHistory || week.status === "unavailable" && !week.rows.some(row => row.canSubmit);
    section.classList.toggle("is-unavailable", unavailable);
    const future = week.isFuture || (week.rows.length > 0 && week.rows.filter(row => !row.excluded).every(row =>
      row.reason === "未开放" || row.reason === "未到上课时间"));
    section.classList.toggle("is-future", future);
    section.open = rendered ? open.has(week.number) : week.number === preferred;
    const header = element("summary", "week-summary");
    const heading = element("span", "week-heading");
    heading.append(element("strong", "", `Week ${week.number}`), element("span", "week-range", `${dateLabel(week.start)} — ${dateLabel(week.end)}`));
    const included = week.rows.filter(row => !row.excluded);
    const done = included.filter(row => row.status === "success").length;
    const weekText = missingHistory ? "历史记录未读取" : week.status === "success" ? "全部完成" : week.status === "unavailable"
      ? (week.rows.some(row => row.canSubmit) ? "部分课次无法签到" : "无法签到")
      : future ? "未开放" : week.status === "empty" ? "无须签到" : `待完成 · ${done}/${included.length}`;
    header.append(heading, stateBadge(week.status, weekText, "week-state"));
    const body = element("div", "week-body");
    if (!week.rows.length) body.append(element("p", "empty-week", "尚未保存这一周的课程记录。"));
    else {
      const columns = element("div", "course-table");
      for (const label of ["日期 / 时间", "课程", "类型 / 编号", "签到码", "状态"]) columns.append(element("span", "", label));
      body.append(columns);
      for (const row of week.rows) {
        const line = element("div", "course-row");
        line.classList.toggle("is-disabled", !row.canSubmit);
        line.classList.toggle("is-unavailable", row.status === "unavailable");
        const time = element("div", "course-time");
        time.append(element("strong", "", dateLabel(row.date)), element("span", "", row.time || "时间见学校网页"));
        const unit = element("div", "course-unit", row.unit || "课程");
        const activity = element("div", "course-activity", row.activity || row.label);
        if (row.deadline) activity.append(element("small", "deadline", `截止 ${row.deadline}`));
        const codeCell = element("div", "course-code");
        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.autocapitalize = "off";
        input.spellcheck = false;
        input.dataset.key = row.key;
        input.dataset.available = String(row.canSubmit);
        input.setAttribute("aria-label", `${row.date} ${row.time} ${row.unit} ${row.activity} 签到码`);
        input.placeholder = row.status === "success" ? "已完成" : row.canSubmit ? "输入签到码" : row.reason || "暂不可填写";
        input.value = drafts.get(row.key) || "";
        input.title = row.reason || "填写老师提供的签到码";
        input.addEventListener("input", () => { drafts.set(row.key, input.value); updateControls(); });
        codeCell.append(input);
        const rowText = row.status === "success" ? "已签到" : row.reason || "待签到";
        const rowState = stateBadge(row.status, rowText, "course-state");
        line.append(time, unit, activity, codeCell, rowState);
        body.append(line);
      }
    }
    section.append(header, body);
    $("weeks").append(section);
  }
  rendered = true;
  updateControls();
}

async function connect() {
  if (busy) return;
  busy = true;
  updateControls();
  status("正在连接", "正在读取学期日期、课程时间和当前签到入口…", "busy");
  try {
    const next = await adapter.connect();
    const saved = next.account ? await recordStore.load(recordKey(next)) : null;
    const same = schedule && recordKey(schedule) === recordKey(next);
    outcomes = same ? outcomes : saved?.outcomes || {};
    schedule = mergeScan(same ? schedule : saved?.schedule, next);
    await saveRecord();
    renderRate();
    if (!settings.startDate && next.semester?.start) {
      settings.startDate = next.semester.start;
      setSettingsFields();
      await saveSettings();
    }
    $("account").textContent = demo ? "模拟课堂" : `已连接${next.account ? ` · ${next.account}` : "学校网页"}`;
    status(demo ? "交互预览已就绪" : "固定课表已读取", demo
      ? "可填写的课次输入任意码可演示成功；error 演示失败，unknown 演示结果不明确，队列继续处理其他课程。"
      : "展开教学周，在课程右侧填写签到码，最后统一提交。请设置 Mid break 的开始日期。");
  } catch (error) {
    schedule = null;
    model = null;
    drafts.clear();
    $("account").textContent = "尚未连接";
    status("需要连接学校网页", error.message, "error");
  } finally { busy = false; renderWeeks(); }
}

$("settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const next = { startDate: $("start-date").value, weekCount: Number($("week-count").value), breakStart: $("break-start").value, includePass: $("include-pass").checked };
  try {
    buildWeeks(schedule || { days: [], courses: [] }, next, {});
    settings = next;
    drafts.clear();
    await saveSettings();
    renderWeeks();
    status("学期设置已保存", "每周课程已重新排列。Mid break 跳过一周，签到期限仍按 7 个日历日计算。");
  } catch (error) { status("请检查学期设置", error.message, "error"); }
});

$("submit-all").addEventListener("click", async () => {
  if (busy || !model) return;
  renderWeeks(); // Recheck deadlines at submission time.
  const batch = selectedRows().map(row => ({ row, code: drafts.get(row.key).trim() }));
  if (!batch.length) return;
  busy = true;
  updateControls();
  $("result-text").hidden = false;
  $("result-text").textContent = "";
  let done = 0;
  let hasUncertain = false;
  for (const item of batch) {
    // A long batch may cross a deadline; check each course immediately before submitting.
    const live = buildWeeks(schedule, settings, outcomes).weeks.flatMap(week => week.rows).find(row => row.key === item.row.key);
    if (!live?.canSubmit) {
      drafts.delete(item.row.key);
      item.code = "";
      continue;
    }
    status(`正在提交 ${done + 1}/${batch.length}`, `${item.row.date} ${item.row.time} · ${item.row.unit} ${item.row.activity}`, "busy");
    outcomes[item.row.key] = { status: "pending", attempted: true, text: "正在提交" };
    try {
      const result = await adapter.submit({ ...item.row.course,
        ...(item.row.deadline ? { deadline: item.row.deadline } : {}) }, item.code);
      outcomes[item.row.key] = { ...result, text: String(result.text || "").split(item.code).join("[签到码已隐藏]"), attempted: true };
      const label = result.status === "success" ? "已确认成功" : result.status === "unavailable" ? "提交失败或无法签到" : "结果待确认";
      $("result-text").textContent += `${item.row.date} ${item.row.time} ${item.row.unit} ${item.row.activity}\n${label}\n${result.text}\n\n`;
      done++;
      if (result.uncertain) hasUncertain = true;
    } catch (error) {
      outcomes[item.row.key] = { status: "pending", attempted: true, uncertain: true, text: error.message };
      $("result-text").textContent += `${item.row.label}\n${error.message}\n\n`;
      hasUncertain = true;
    }
    drafts.delete(item.row.key);
    item.code = "";
    renderWeeks();
    try { await saveRecord(); } catch (error) { $("result-text").textContent += `记录保存失败：${error.message}\n`; }
  }
  for (const item of batch) item.code = "";
  try {
    const next = await adapter.connect();
    if (recordKey(next) === recordKey(schedule)) {
      schedule = mergeScan(schedule, next);
      await saveRecord();
      renderRate();
    }
  } catch { /* Keep confirmed results if the rate refresh fails. */ }
  busy = false;
  renderWeeks();
  status(hasUncertain ? "批量处理完成，部分结果待确认" : "本次提交已处理", hasUncertain
    ? "部分课次结果无法确认，请打开学校网页检查。其他已填写课次已继续处理；待确认课次没有重复提交。"
    : `已处理 ${done} 节课，请查看逐节结果。签到码错误的课次可直接修改后再次提交。`,
    hasUncertain ? "warning" : "info");
});

$("include-pass").addEventListener("change", async () => {
  settings.includePass = $("include-pass").checked;
  await saveSettings();
  renderWeeks();
});
$("connect").addEventListener("click", connect);
$("refresh").addEventListener("click", connect);
$("open-site").addEventListener("click", async () => {
  try { await adapter.openSite(); }
  catch { status("无法打开网页", "请手动打开学校签到网站。", "error"); }
});
$("demo-banner").hidden = !demo;
$("today").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Kuala_Lumpur", month: "long", day: "numeric", weekday: "long"
}).format(new Date());
try {
  const saved = demo ? JSON.parse(localStorage.getItem("attendance-helper-calendar-v2") || "null")
    : (await chrome.storage.local.get("calendar")).calendar;
  if (saved) { buildWeeks({ days: [], courses: [] }, saved); settings = saved; }
} catch { /* Invalid or unavailable saved settings should not stop the interface. */ }
setSettingsFields();
status("准备开始", "先在学校网页登录，再连接课表并设置学期日期。");
renderWeeks();
if (demo) await connect();
setInterval(() => { if (!busy && model && !document.querySelector("input[data-key]:focus")) renderWeeks(); }, 30000);
