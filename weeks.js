const DAY = 86400000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function schoolDate(value) {
  if (typeof value !== "string") return null;
  let text = value.trim();
  const school = /^(\d{1,2})_([a-z]{3})_(\d{2}|\d{4})$/i.exec(text);
  if (school) {
    const month = MONTHS.indexOf(school[2].toLowerCase()) + 1;
    if (!month) return null;
    const year = school[3].length === 2 ? `20${school[3]}` : school[3];
    text = `${year}-${String(month).padStart(2, "0")}-${school[1].padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text ? text : null;
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function parseCourse(course) {
  const date = schoolDate(course.day);
  if (!date) return null;
  const label = String(course.label || "未命名课程").replace(/\s+/g, " ").trim();
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(label)
    || /^(\d{1,2}):(\d{2})(?=\s|·|$)/.exec(label);
  let time = "";
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] || "0");
    if (minute < 60 && (clock[3] ? hour >= 1 && hour <= 12 : hour < 24)) {
      if (clock[3]) hour = hour % 12 + (clock[3].toLowerCase() === "pm" ? 12 : 0);
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const unitMatch = /\b([a-z]{2,6}\d{4}[a-z]?)\b/i.exec(label);
  const unit = unitMatch ? unitMatch[1].toUpperCase() : "";
  const activityText = unitMatch ? label.slice(unitMatch.index + unitMatch[0].length)
    .replace(/^[\s·|:–—-]+/, "").trim() : "";
  const parsed = Boolean(time && unit && activityText);
  const activity = parsed ? activityText : label;
  const [activityType, ...number] = parsed ? activity.split(" ") : [];
  const identity = parsed ? `${unit}|${time}|${activity.toLowerCase()}` : `label:${label.toLowerCase()}`;
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), time, unit, activity,
    activityType: activityType || "", activityNumber: number.join(" "), label, identity, parsed };
}

function courseStatus(course) {
  if (course?.status === "success") return "success";
  return ["unavailable", "closed", "error", "failed"].includes(course?.status) ? "unavailable" : "pending";
}

export function buildWeeks(schedule, settings, outcomes = {}, now = new Date()) {
  const startDate = schoolDate(settings?.startDate);
  const weekCount = Number(settings?.weekCount);
  const breakStart = settings?.breakStart ? schoolDate(settings.breakStart) : null;
  if (!startDate) throw new Error("请选择有效的学期开始日期。");
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52) {
    throw new Error("教学周数必须是 1 至 52 之间的整数。");
  }
  if (settings?.breakStart && !breakStart) throw new Error("请选择有效的 Mid break 开始日期。");
  if (breakStart && (breakStart < startDate || breakStart > addDays(startDate, weekCount * 7 - 1))) {
    throw new Error("Mid break 必须从学期开始日至最后一个教学周之间开始。");
  }
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowTime)) throw new Error("当前时间无效，请重新打开签到助手。");

  const availableDates = [...new Set((schedule?.days || []).map(day => schoolDate(day.value)).filter(Boolean))].sort();
  const range = { start: availableDates[0] || null, end: availableDates.at(-1) || null };
  const templates = new Map();
  const live = new Map();
  let unparsedCount = 0;
  for (const course of schedule?.templateCourses || []) {
    const parsed = parseCourse(course);
    if (parsed) templates.set(`${parsed.weekday}|${parsed.identity}`, parsed);
  }
  for (const course of schedule?.courses || []) {
    const parsed = parseCourse(course);
    if (!parsed?.parsed) unparsedCount++;
    if (!parsed) continue;
    const templateKey = `${parsed.weekday}|${parsed.identity}`;
    if (!schedule?.templateCourses && !templates.has(templateKey)) templates.set(templateKey, parsed);
    const liveKey = `${parsed.date}|${parsed.identity}`;
    const previous = live.get(liveKey);
    if (!previous || courseStatus(course) === "success"
        || (courseStatus(previous) !== "success" && !previous.url && course.url)) live.set(liveKey, course);
  }

  const weeks = [];
  let cursor = startDate;
  const breakEnd = breakStart ? addDays(breakStart, 7) : null;
  for (let number = 1; number <= weekCount; number++) {
    const dates = [];
    while (dates.length < 7) {
      if (breakStart && cursor >= breakStart && cursor < breakEnd) cursor = breakEnd;
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    const rows = [];
    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const dayTemplates = schedule?.snapshotMode && date < schedule.templateFrom
        ? [...live.entries()].filter(([key]) => key.startsWith(`${date}|`)).map(([, course]) => parseCourse(course))
        : [...templates.values()];
      for (const template of dayTemplates) {
        if (template.weekday !== weekday) continue;
        const course = live.get(`${date}|${template.identity}`) || null;
        const key = `${date}|${template.unit}|${template.time}|${template.activity}`;
        let status = courseStatus(course);
        let reason = status === "success" ? "已签到" : status === "unavailable" ? "无法签到" : "待填写签到码";
        let canSubmit = Boolean(course?.url) && status === "pending";
        if (status !== "success") {
          if (!range.start) { status = "unavailable"; reason = "尚未读取可签到日期"; canSubmit = false; }
          else if (date < range.start) { status = "unavailable"; reason = "已关闭"; canSubmit = false; }
          else if (date > range.end) { status = "pending"; reason = "未开放"; canSubmit = false; }
          else if (!course?.url) { status = "unavailable"; reason = "无签到入口"; canSubmit = false; }
        }
        const outcome = outcomes[key];
        if (outcome && status !== "success") {
          status = outcome.uncertain ? "pending" : courseStatus(outcome);
          reason = status === "success" ? "已签到" : status === "unavailable" ? "提交失败 / 无法签到"
            : outcome.uncertain ? "结果待确认" : "已提交，待确认";
          canSubmit = canSubmit && status === "pending" && !outcome.attempted;
        }
        const start = template.time ? Date.parse(`${date}T${template.time}:00+08:00`) : null;
        const deadlineDate = template.time ? addDays(date, 7) : null;
        const deadline = deadlineDate ? `${deadlineDate} ${template.time}` : null;
        if (status !== "success" && start !== null) {
          if (nowTime >= start + 7 * DAY) {
            status = "unavailable"; reason = "已超过7天签到期限"; canSubmit = false;
          } else if (nowTime < start) {
            status = "pending"; reason = "未到上课时间"; canSubmit = false;
          }
        }
        const isPass = /\bPASS\b/i.test(template.label);
        const excluded = isPass && !settings.includePass;
        if (excluded) { status = "empty"; reason = "PASS 不计入辅助签到"; canSubmit = false; }
        if (outcome?.text && status !== "success" && !excluded && outcome.retryable && start !== null && nowTime >= start && nowTime < start + 7 * DAY) {
          reason = "签到码错误，请修改后重试";
          canSubmit = Boolean(course?.url) && !excluded && nowTime >= start && nowTime < start + 7 * DAY;
        }
        rows.push({ isPass, excluded, key, date, time: template.time, unit: template.unit, activity: template.activity,
          activityType: template.activityType, activityNumber: template.activityNumber,
          label: template.label, course, status, reason, canSubmit, deadline });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
      || a.unit.localeCompare(b.unit) || a.activity.localeCompare(b.activity));
    const included = rows.filter(row => !row.excluded);
    const status = !included.length ? "empty" : included.every(row => row.status === "success") ? "success"
      : included.some(row => row.status === "unavailable") ? "unavailable" : "pending";
    weeks.push({ number, start: dates[0], end: dates.at(-1), rows, status,
      isPast: Boolean(range.start && dates.at(-1) < range.start),
      isFuture: Boolean(range.end && dates[0] > range.end) });
  }
  return { weeks, range, templateCount: templates.size, unparsedCount };
}
