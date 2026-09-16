// These functions run in the school tab via chrome.scripting. Keep them self-contained.
export function readSchedule() {
  const select = document.getElementById("daySel");
  if (!select) return null;
  const days = Array.from(select.options, option => ({
    value: option.value, label: option.textContent.trim()
  }));
  const seen = new Set();
  const courses = [];
  for (const anchor of document.querySelectorAll('a[href*="Entry.aspx"]')) {
    let url;
    try { url = new URL(anchor.getAttribute("href"), location.href); }
    catch { continue; }
    const key = JSON.stringify([url.searchParams.get("s"), url.searchParams.get("d")]);
    if (url.origin !== "https://attendance.monash.edu.my" ||
        url.pathname !== "/student/Entry.aspx" ||
        !url.searchParams.get("s") ||
        !days.some(day => day.value === url.searchParams.get("d")) ||
        seen.has(key)) continue;
    seen.add(key);
    const icon = anchor.querySelector("img")?.getAttribute("src")?.split("/").pop()?.split(/[?#]/)[0] || "";
    courses.push({ url: url.href, day: url.searchParams.get("d"),
      label: anchor.textContent.replace(/\s+/g, " ").trim(), icon,
      status: icon.toLowerCase() === "tick.png" ? "success" : icon.toLowerCase() === "question.png" ? "pending" : "unknown" });
  }
  // Completed and future sessions are static list items, not links.
  for (const panel of document.querySelectorAll('.dayPanel[id^="dayPanel_"]')) {
    const day = panel.id.slice("dayPanel_".length);
    if (!days.some(item => item.value === day)) continue;
    for (const item of panel.querySelectorAll("li")) {
      if (item.querySelector('a[href*="Entry.aspx"]')) continue;
      const label = item.textContent.replace(/\s+/g, " ").trim();
      if (!/\b[A-Z]{2,6}\d{4}\b/i.test(label)) continue;
      const icon = item.querySelector("img")?.getAttribute("src")?.split("/").pop()?.split(/[?#]/)[0] || "";
      courses.push({ day, label, icon, status: icon.toLowerCase() === "tick.png" ? "success" : "pending" });
    }
  }
  const account = document.getElementById("ctl00_ContentPlaceHolder1_userName")?.textContent.trim() || "";
  return { days, courses, selectedDay: select.value, account };
}

export function readSemester() {
  const text = document.getElementById("ctl00_ContentPlaceHolder1_periodBox")?.textContent || "";
  const match = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dates = [1, 4].map(index => {
    const month = months.indexOf(match[index + 1].toLowerCase());
    if (month < 0) return null;
    const date = new Date(Date.UTC(Number(match[index + 2]), month, Number(match[index])));
    if (date.getUTCFullYear() !== Number(match[index + 2]) || date.getUTCMonth() !== month ||
        date.getUTCDate() !== Number(match[index])) return null;
    return date.toISOString().slice(0, 10);
  });
  return dates[0] && dates[1] && dates[0] <= dates[1] ? { start: dates[0], end: dates[1] } : null;
}

// Only affirmative statements about the attendance record establish success.
// Generic percentages, instructions and unknown icon names are not evidence.
export function classifyAttendanceResult(text) {
  const statements = String(text || "").split(/[\r\n.!]+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const instructions = /\b(if|when|once|please|ensure|will|would|should|must|may|might|whether|how)\b/i;
  const negative = /\b(not|never|no|cannot|unable|failed|unsuccessful(?:ly)?|\w+n['’]t)\b/i;
  const failure = /^(?:invalid|incorrect|expired|closed|unavailable)$|\b(?:invalid|incorrect|wrong|expired)\b.*\b(?:code|attendance|session)\b|\b(?:code|attendance|session)\b.*\b(?:invalid|incorrect|expired|closed|failed|unavailable)\b|\btoo late\b|\b(?:error|failed|failure)\b|\b(?:not|never)\b.*\b(?:recorded|registered|marked|valid)\b|\b(?:unable|cannot|couldn['’]t|wasn['’]t|hasn['’]t)\b.*\b(?:record|register|mark|recorded|registered|marked)\b/i;
  const affirmative = /^(?:(?:your|the)\s+)?attendance\s+(?:(?:has\s+(?:already\s+)?been|is|was)\s+)?(?:(?:already|successfully)\s+)?(?:recorded|registered|marked)(?:\s+(?:successfully|as present))?(?:\s+(?:for|on|at)\s+[^?]+)?$|^you have (?:successfully |already )?(?:recorded|registered|marked) your attendance(?: successfully)?$|^attendance (?:registration|recording) (?:was |is )?successful$/i;
  const feedback = statements.filter(line => !line.includes("?") && !instructions.test(line));
  if (feedback.some(line => failure.test(line))) return "unavailable";
  if (feedback.some(line => !negative.test(line) && affirmative.test(line))) return "success";
  return "pending";
}

export function submitAttendance({ expectedUrl, code, deadline, expectedAccount }) {
  if (expectedAccount !== undefined && (!expectedAccount ||
      document.getElementById("ctl00_ContentPlaceHolder1_userName")?.textContent.trim() !== expectedAccount)) {
    return { submitted: false, accountChanged: true, reason: "账户已变化或无法核实，请重新连接。" };
  }
  const current = new URL(location.href);
  let expected;
  try { expected = new URL(expectedUrl); }
  catch { return { submitted: false, reason: "所选课次链接无效，请刷新课程后重试。" }; }
  if (current.origin !== "https://attendance.monash.edu.my" ||
      current.pathname !== "/student/Entry.aspx" ||
      expected.origin !== current.origin || expected.pathname !== current.pathname ||
      !current.searchParams.get("s") || !current.searchParams.get("d") ||
      current.searchParams.get("s") !== expected.searchParams.get("s") ||
      current.searchParams.get("d") !== expected.searchParams.get("d")) {
    return { submitted: false, reason: "网页课次与所选课程不一致，请刷新课程后重试。" };
  }
  let cutoff;
  if (deadline !== undefined) {
    cutoff = typeof deadline === "string" && /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(deadline)
      ? Date.parse(`${deadline.replace(" ", "T")}:00+08:00`) : NaN;
    if (!Number.isFinite(cutoff) || new Date(cutoff + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ") !== deadline) {
      return { submitted: false, reason: "签到期限无效，请刷新课程后重试。" };
    }
    if (Date.now() >= cutoff) return { submitted: false, reason: "已超过7天签到期限。" };
  }
  const input = document.getElementById("ctl00_ContentPlaceHolder1_sessionCode");
  const form = input?.form;
  const button = form?.querySelector('input[type="submit"][value="Submit"]');
  if (!(input instanceof HTMLInputElement) || !form || !button ||
      input.disabled || input.readOnly || button.disabled) {
    return { submitted: false, reason: "未找到可用的签到表单，请在学校网页检查登录和课次。" };
  }
  if (typeof code !== "string" || !code.trim()) {
    return { submitted: false, reason: "请先输入老师提供的签到码。" };
  }
  // Use the original form so that the site's hidden fields and validation stay intact.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, code.trim());
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (!form.checkValidity()) {
    form.reportValidity();
    return { submitted: false, reason: "签到码未通过网页表单校验，请在学校网页检查。" };
  }
  const beforeText = document.body.innerText;
  if (cutoff !== undefined && Date.now() >= cutoff) return { submitted: false, reason: "已超过7天签到期限。" };
  button.click();
  return { submitted: true, beforeText, documentId: globalThis.performance?.timeOrigin };
}

export function readPageResult() {
  return { url: location.href, text: document.body.innerText,
    account: document.getElementById("ctl00_ContentPlaceHolder1_userName")?.textContent.trim() || "", documentId: globalThis.performance?.timeOrigin,
    hasForm: Boolean(document.getElementById("ctl00_ContentPlaceHolder1_sessionCode")),
    ready: document.readyState === "complete" };
}

export function readOverallRate() {
  const text = document.getElementById("ctl00_ContentPlaceHolder1_attendanceInfoBox")?.textContent || "";
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match && Number(match[1]) <= 100 ? Number(match[1]) : null;
}

// Fetch a fresh authenticated page: an already-open tab may still show the old user.
export async function readSessionAccount() {
  try {
    const response = await fetch("https://attendance.monash.edu.my/student/", {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!response.ok || !response.url.startsWith("https://attendance.monash.edu.my/student/")) return "";
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    return doc.getElementById("ctl00_ContentPlaceHolder1_userName")?.textContent.trim() || "";
  } catch { return ""; }
}
