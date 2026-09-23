import { readSessionAccount, readOverallRate, readSchedule, readSemester, submitAttendance, readPageResult, classifyAttendanceResult } from "./page.js";

const HOME = "https://attendance.monash.edu.my/student/";
const UNITS = `${HOME}Units.aspx`;
const INFO = `${HOME}AttendanceInfo.aspx`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const samePage = (current, expected) => current.origin === expected.origin &&
  current.pathname === expected.pathname &&
  current.searchParams.get("s") === expected.searchParams.get("s") &&
  current.searchParams.get("d") === expected.searchParams.get("d");

export function createBrowserAdapter() {
  let tabId;
  let connectedAccount = "";
  const accountFailure = () => ({ status: "pending", uncertain: false, accountChanged: true,
    text: "学校账户已变化或无法核实，请重新连接。" });
  async function run(func, args = []) {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return results[0]?.result;
  }
  async function waitForSchoolPage(expectedUrl) {
    const expected = expectedUrl && new URL(expectedUrl);
    for (let attempt = 0; attempt < 40; attempt++) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        if (!tab.url?.startsWith(HOME)) {
          throw new Error("请先在学校网页完成登录，然后回到这里重新连接。");
        }
        const current = new URL(tab.url);
        if (!expected || samePage(current, expected)) return tab;
      }
      await pause(250);
    }
    throw new Error("学校网页加载超时，请检查页面后重新连接。");
  }
  return {
    async connect() {
      connectedAccount = "";
      const tabs = await chrome.tabs.query({ url: `${HOME}*` });
      const selected = tabs.find(tab => tab.id === tabId) ||
        [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (!selected) {
        const opened = await chrome.tabs.create({ url: UNITS });
        tabId = opened.id;
        throw new Error("已打开学校网页。请完成登录，再回到这里点击“连接签到网页”。");
      }
      tabId = selected.id;
      await waitForSchoolPage();
      await chrome.tabs.update(tabId, { url: HOME });
      await waitForSchoolPage(HOME);
      const account = await run(readSessionAccount);
      if (!account) throw new Error("无法核实学校账户，请重新登录后连接。");
      const overallRate = await run(readOverallRate);
      await chrome.tabs.update(tabId, { url: INFO });
      await waitForSchoolPage(INFO);
      const semester = await run(readSemester);
      // Navigate with GET, including when the current tab is a submitted form.
      await chrome.tabs.update(tabId, { url: UNITS });
      await waitForSchoolPage(UNITS);
      const schedule = await run(readSchedule);
      if (!schedule) throw new Error("未读取到课程列表，请检查学校网页是否已登录或是否变更了页面。");
      if (!semester?.start || schedule.account !== account || await run(readSessionAccount) !== account) {
        throw new Error("连接期间账户已变化，或无法读取学期，请重新连接。");
      }
      connectedAccount = account;
      return { ...schedule, semester, overallRate };
    },
    async submit(course, code, expectedAccount = connectedAccount) {
      if (!tabId) throw new Error("请先连接签到网页。");
      const url = new URL(course.url);
      if (url.origin !== "https://attendance.monash.edu.my" ||
          url.pathname !== "/student/Entry.aspx" || !url.searchParams.get("s") ||
          !url.searchParams.get("d") || url.searchParams.get("d") !== course.day) {
        throw new Error("所选课次链接无效，请刷新课程后重试。");
      }
      if (typeof code !== "string" || !code.trim()) throw new Error("请先输入老师提供的签到码。");
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== "complete" || !tab.url || !samePage(new URL(tab.url), url)) {
        await chrome.tabs.update(tabId, { url: course.url });
      }
      await waitForSchoolPage(course.url);
      if (course.deadline !== undefined) {
        const deadline = course.deadline;
        const cutoff = typeof deadline === "string" && /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(deadline)
          ? Date.parse(`${deadline.replace(" ", "T")}:00+08:00`) : NaN;
        if (!Number.isFinite(cutoff) || new Date(cutoff + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ") !== deadline) {
          return { status: "unavailable", uncertain: false, text: "签到期限无效，请刷新课程后重试。" };
        }
        if (Date.now() >= cutoff) return { status: "unavailable", uncertain: false, text: "已超过7天签到期限。" };
      }
      try {
        if (!expectedAccount || expectedAccount !== connectedAccount || await run(readSessionAccount) !== expectedAccount) return accountFailure();
      } catch { return accountFailure(); }
      let response;
      try {
        response = await run(submitAttendance, [{ expectedUrl: course.url, code, deadline: course.deadline, expectedAccount: connectedAccount, verifiedAccount: expectedAccount }]);
      } catch {
        // Navigation may interrupt the response after a click. Never retry automatically.
        response = { submitted: true, beforeText: "", interrupted: true };
      }
      if (response?.accountChanged) return accountFailure();
      if (response?.submitted === false) return { status: "unavailable", uncertain: false,
        text: response?.reason || "表单未提交，请检查学校网页。" };
      if (!response?.submitted) return { status: "pending", uncertain: true,
        text: "暂未收到提交操作的反馈，请检查学校网页，避免重复提交。" };
      const previousLines = new Set(response.beforeText.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()));
      let latestText = "";
      for (let attempt = 0; attempt < 16; attempt++) {
        await pause(250);
        try {
          const page = await run(readPageResult);
          if (page?.ready) {
            if (!page.url?.startsWith(HOME)) return accountFailure();
            // Result/entry pages can omit the name even while logged in.
            const account = page.account || await run(readSessionAccount);
            if (account !== connectedAccount) return accountFailure();
          }
          if (page?.ready && new URL(page.url).pathname === "/student/Units.aspx") break;
          if (page?.ready && (page.url !== course.url || page.text !== response.beforeText || (page.documentId && response.documentId && page.documentId !== response.documentId))) {
            const freshText = page.documentId && response.documentId && page.documentId !== response.documentId ? page.text : page.text.split(/\r?\n/)
              .filter(line => !previousLines.has(line.replace(/\s+/g, " ").trim())).join("\n");
            const status = classifyAttendanceResult(freshText);
            latestText = page.text.trim().slice(0, 4000);
            if (status !== "pending") return { status, uncertain: false,
              retryable: status === "unavailable" && /(?:invalid|incorrect|wrong).*code|code.*(?:invalid|incorrect|wrong)/i.test(freshText), text: latestText };
            if (page.hasForm === false) break;
          }
        } catch { /* A normal document navigation can briefly make the tab unavailable. */ }
      }
      // A successful POST can return the list instead of a textual confirmation.
      // Read the exact session's official tick before deciding its result.
      try {
        await chrome.tabs.update(tabId, { url: UNITS });
        await waitForSchoolPage(UNITS);
        const scanned = await run(readSchedule);
        if (scanned?.account !== connectedAccount) return accountFailure();
        const completed = scanned?.courses.find(item => item.day === course.day && item.label === course.label && item.status === "success");
        if (completed) return { status: "success", uncertain: false, text: "学校课程列表已标记签到成功。" };
      } catch { /* Leave this course uncertain without repeating its POST. */ }
      return { status: "pending", uncertain: true, text: latestText || "已执行一次提交，但暂未读取到新的网页反馈。请打开学校网页核对结果。" };
    },
    async openSite() {
      if (tabId) {
        try {
          const tab = await chrome.tabs.update(tabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return;
        } catch { tabId = undefined; }
      }
      const tab = await chrome.tabs.create({ url: HOME });
      tabId = tab.id;
    }
  };
}
