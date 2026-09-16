import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../weeks.js", import.meta.url), "utf8");
const { schoolDate, buildWeeks } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const settings = { startDate: "2026-09-07", weekCount: 4, breakStart: "" };
const now = new Date("2026-09-16T15:00:00+08:00");
const course = (day, label = "2:00 pm FIT2014 Applied 01", status = "pending", id = day) => ({
  day, label, status, url: `https://attendance.monash.edu.my/student/Entry.aspx?s=${id}&d=${day}`
});
const schedule = (courses, dates = ["14_Sep_26", "15_Sep_26", "16_Sep_26"]) => ({
  days: dates.map(value => ({ value, label: value })), courses, selectedDay: dates.at(-1)
});

test("school dates are normalized and calendar-invalid dates rejected", () => {
  assert.equal(schoolDate("14_Sep_26"), "2026-09-14");
  assert.equal(schoolDate("1_JAN_2027"), "2027-01-01");
  assert.equal(schoolDate("2028-02-29"), "2028-02-29");
  for (const input of ["2026-02-29", "31_Apr_26", "2026-13-01", "2026-00-01", "2026-01-32", "14_Foo_26", "", null, 2026]) {
    assert.equal(schoolDate(input), null, String(input));
  }
});

test("Week 8 and Week 9 retain numbering across a seven-day midbreak", () => {
  const model = buildWeeks(schedule([course("14_Sep_26")]), {
    startDate: "2026-08-03", weekCount: 12, breakStart: "2026-09-28"
  }, {}, now);
  assert.equal(model.weeks.length, 12);
  assert.equal(model.weeks[7].start, "2026-09-21");
  assert.equal(model.weeks[7].end, "2026-09-27");
  assert.equal(model.weeks[8].start, "2026-10-05");
  assert.equal(model.weeks[8].number, 9);
  assert.equal(model.weeks[11].end, "2026-11-01");
  assert.ok(model.weeks.every(week => week.rows.every(row => row.date < "2026-09-28" || row.date >= "2026-10-05")));
});

test("midweek start and midweek break count seven teaching calendar days", () => {
  const model = buildWeeks(schedule([course("16_Sep_26")]), {
    startDate: "2026-09-07", weekCount: 2, breakStart: "2026-09-09"
  }, {}, now);
  assert.equal(model.weeks[0].start, "2026-09-07");
  assert.equal(model.weeks[0].end, "2026-09-20");
  assert.equal(model.weeks[0].rows[0].date, "2026-09-16");
  assert.equal(model.weeks[1].start, "2026-09-21");
  const midweek = buildWeeks(null, { startDate: "2026-09-09", weekCount: 1 }, {}, now);
  assert.equal(midweek.weeks[0].end, "2026-09-15");
});

test("old weeks are unavailable and future weeks have no invented links", () => {
  const model = buildWeeks(schedule([course("14_Sep_26")]), settings, {}, now);
  assert.deepEqual(model.range, { start: "2026-09-14", end: "2026-09-16" });
  assert.equal(model.weeks[0].status, "unavailable");
  assert.equal(model.weeks[0].isPast, true);
  assert.equal(model.weeks[0].rows[0].canSubmit, false);
  assert.equal(model.weeks[1].rows[0].canSubmit, true);
  assert.equal(model.weeks[2].status, "pending");
  assert.equal(model.weeks[2].isFuture, true);
  assert.equal(model.weeks[2].rows[0].course, null);
  assert.equal(model.weeks[2].rows[0].canSubmit, false);
});

test("session links match exact calendar dates even for identical weekly patterns", () => {
  const older = course("14_Sep_26", undefined, "pending", "older-session");
  const newer = course("21_Sep_26", undefined, "pending", "newer-session");
  const model = buildWeeks(schedule([older, newer], ["14_Sep_26", "21_Sep_26"]), settings, {}, new Date("2026-09-21T13:59:59+08:00"));
  assert.equal(model.templateCount, 1);
  assert.equal(model.weeks[1].rows[0].course.url, older.url);
  assert.equal(model.weeks[1].rows[0].canSubmit, true);
  assert.equal(model.weeks[2].rows[0].course.url, newer.url);
  assert.equal(model.weeks[2].rows[0].canSubmit, false);
  assert.equal(model.weeks[3].rows[0].course, null);
});

test("same unit's different time, activity and weekday all remain distinct", () => {
  const model = buildWeeks(schedule([
    course("14_Sep_26", "2:00 pm FIT2014 Seminar 01-P1"),
    course("14_Sep_26", "2:00 pm FIT2014 Seminar 01-P1"),
    course("14_Sep_26", "4:00 pm FIT2014 Seminar 01-P1"),
    course("14_Sep_26", "2:00 pm FIT2014 Applied 01"),
    course("16_Sep_26", "2:00 pm FIT2014 Applied 01"),
    course("16_Sep_26", "6:00 pm FIT2109 Workshop 01")
  ]), settings, {}, now);
  assert.equal(model.templateCount, 5);
  assert.equal(model.weeks[1].rows.length, 5);
  const seminar = model.weeks[1].rows.find(row => row.activity === "Seminar 01-P1");
  assert.equal(seminar.unit, "FIT2014");
  assert.equal(seminar.time, "14:00");
  assert.equal(seminar.activityType, "Seminar");
  assert.equal(seminar.activityNumber, "01-P1");
  assert.equal(new Set(model.weeks[1].rows.map(row => row.key)).size, 5);
});

test("only every confirmed row makes a week successful, with empty weeks neutral", () => {
  const courses = [course("14_Sep_26", undefined, "success"), course("16_Sep_26", undefined, "success")];
  const complete = buildWeeks(schedule(courses), settings, {}, now);
  assert.equal(complete.weeks[1].status, "success");
  assert.ok(complete.weeks[1].rows.every(row => !row.canSubmit));
  courses[1].status = "pending";
  assert.equal(buildWeeks(schedule(courses), settings, {}, now).weeks[1].status, "pending");
  const empty = buildWeeks(null, settings, {}, now);
  assert.equal(empty.templateCount, 0);
  assert.ok(empty.weeks.every(week => week.status === "empty" && !week.rows.length));
});

test("duplicate rows do not downgrade an already confirmed attendance status", () => {
  const confirmed = { ...course("14_Sep_26", undefined, "success"), url: "" };
  const model = buildWeeks(schedule([confirmed, course("14_Sep_26")]), settings, {}, now);
  assert.equal(model.templateCount, 1);
  assert.equal(model.weeks[1].rows[0].status, "success");
  assert.equal(model.weeks[1].rows[0].canSubmit, false);
});

test("missing exact entries inside the school date range are unavailable", () => {
  const model = buildWeeks(schedule([course("08_Sep_26")]), settings, {}, now);
  const row = model.weeks[1].rows[0];
  assert.equal(row.date, "2026-09-15");
  assert.equal(row.course, null);
  assert.equal(row.reason, "无签到入口");
  assert.equal(row.status, "unavailable");
  assert.equal(row.canSubmit, false);
});

test("a past occurrence missing from the latest window does not become submittable", () => {
  const model = buildWeeks(schedule([course("14_Sep_26")], ["15_Sep_26", "16_Sep_26"]), settings, {}, now);
  assert.equal(model.weeks[1].rows[0].reason, "已关闭");
  assert.equal(model.weeks[1].rows[0].canSubmit, false);
});

test("submission outcomes override row display and attempted submissions cannot repeat", () => {
  const data = schedule([course("14_Sep_26")]);
  const row = buildWeeks(data, settings, {}, now).weeks[1].rows[0];
  const failed = buildWeeks(data, settings, { [row.key]: { status: "unavailable", text: "Invalid code", attempted: true } }, now);
  assert.equal(failed.weeks[1].status, "unavailable");
  assert.equal(failed.weeks[1].rows[0].reason, "提交失败 / 无法签到");
  assert.equal(failed.weeks[1].rows[0].canSubmit, false);
  const uncertain = buildWeeks(data, settings, { [row.key]: { status: "success", uncertain: true, attempted: true } }, now);
  assert.equal(uncertain.weeks[1].status, "pending");
  assert.equal(uncertain.weeks[1].rows[0].canSubmit, false);
  const success = buildWeeks(data, settings, { [row.key]: { status: "success", attempted: true } }, new Date("2026-10-01T00:00:00+08:00"));
  assert.equal(success.weeks[1].status, "success");
  assert.equal(success.weeks[1].rows[0].canSubmit, false);
});

test("Malaysia time closes precisely seven calendar days after class start", () => {
  const data = schedule([course("14_Sep_26")]);
  const immediatelyBefore = buildWeeks(data, settings, {}, new Date("2026-09-21T13:59:59+08:00")).weeks[1].rows[0];
  assert.equal(immediatelyBefore.canSubmit, true);
  assert.equal(immediatelyBefore.deadline, "2026-09-21 14:00");
  const atDeadline = buildWeeks(data, settings, {}, new Date("2026-09-21T06:00:00Z")).weeks[1].rows[0];
  assert.equal(atDeadline.status, "unavailable");
  assert.equal(atDeadline.reason, "已超过7天签到期限");
  assert.equal(atDeadline.canSubmit, false);
});

test("live links cannot submit before class start but open at the exact start", () => {
  const data = schedule([course("16_Sep_26")]);
  const before = buildWeeks(data, settings, {}, new Date("2026-09-16T13:59:59+08:00")).weeks[1].rows[0];
  assert.equal(before.reason, "未到上课时间");
  assert.equal(before.canSubmit, false);
  const atStart = buildWeeks(data, settings, {}, new Date("2026-09-16T14:00:00+08:00")).weeks[1].rows[0];
  assert.equal(atStart.canSubmit, true);
});

test("a week may contain expired and active classes and must show unavailable", () => {
  const data = schedule([course("14_Sep_26"), course("16_Sep_26")]);
  const week = buildWeeks(data, settings, {}, new Date("2026-09-21T14:00:00+08:00")).weeks[1];
  assert.equal(week.rows[0].status, "unavailable");
  assert.equal(week.rows[1].canSubmit, true);
  assert.equal(week.status, "unavailable");
});

test("midbreak does not extend the seven-calendar-day submission deadline", () => {
  const data = schedule([course("21_Sep_26")], ["21_Sep_26"]);
  const config = { startDate: "2026-09-21", weekCount: 2, breakStart: "2026-09-28" };
  const model = buildWeeks(data, config, {}, new Date("2026-09-28T14:00:00+08:00"));
  assert.equal(model.weeks[0].rows[0].deadline, "2026-09-28 14:00");
  assert.equal(model.weeks[0].rows[0].canSubmit, false);
  assert.equal(model.weeks[1].rows[0].date, "2026-10-05");
});

test("unparsed labels remain distinguishable and do not get fabricated times", () => {
  const model = buildWeeks(schedule([
    course("14_Sep_26", "Special student session A"), course("14_Sep_26", "Special student session B"),
    course("not-a-date", "FIT2014 Invalid date")
  ]), settings, {}, now);
  assert.equal(model.unparsedCount, 3);
  assert.equal(model.templateCount, 2);
  assert.equal(model.weeks[1].rows.length, 2);
  assert.ok(model.weeks[1].rows.every(row => row.time === "" && row.deadline === null));
  assert.notEqual(model.weeks[1].rows[0].key, model.weeks[1].rows[1].key);
});

test("12 am, 12 pm and 24-hour label clocks use the correct hour", () => {
  const model = buildWeeks(schedule([
    course("14_Sep_26", "12:00 am FIT2014 Applied 01"),
    course("14_Sep_26", "12:00 pm FIT2014 Applied 02"),
    course("14_Sep_26", "18:30 FIT2109 Workshop 01")
  ]), settings, {}, now);
  assert.deepEqual(model.weeks[1].rows.map(row => row.time), ["00:00", "12:00", "18:30"]);
});

test("invalid semester settings fail with an actionable message", () => {
  for (const patch of [
    { startDate: "2026-02-30" }, { weekCount: 0 }, { weekCount: 53 }, { weekCount: 1.5 },
    { weekCount: "abc" }, { breakStart: "2026-02-30" },
    { breakStart: "2026-09-06" }, { breakStart: "2026-10-05" }
  ]) assert.throws(() => buildWeeks(null, { ...settings, ...patch }, {}, now), /日期|周数|Mid break/);
  assert.equal(buildWeeks(null, { startDate: "2026-09-07", weekCount: "52" }, {}, now).weeks.length, 52);
});

test("learned timetable survives refresh without reusing old submission links", () => {
  const data = schedule([]);
  data.templateCourses = [course("14_Sep_26")];
  const model = buildWeeks(data, settings, {}, now);
  assert.equal(model.templateCount, 1);
  assert.equal(model.weeks[1].rows[0].date, "2026-09-14");
  assert.equal(model.weeks[1].rows[0].course, null);
  assert.equal(model.weeks[1].rows[0].canSubmit, false);
  assert.equal(model.weeks[1].rows[0].reason, "无签到入口");
});

test("row status stays concise while raw feedback remains outside the model", () => {
  const data = schedule([course("14_Sep_26")]);
  const key = buildWeeks(data, settings, {}, now).weeks[1].rows[0].key;
  const result = buildWeeks(data, settings, { [key]: {
    status: "unavailable", text: "Long raw school response ".repeat(200), attempted: true
  } }, now);
  assert.equal(result.weeks[1].rows[0].reason, "提交失败 / 无法签到");
  assert.equal(result.weeks[1].rows[0].canSubmit, false);
});
