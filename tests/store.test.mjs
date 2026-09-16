import test from "node:test";
import assert from "node:assert/strict";
import { mergeScan, recordKey, createRecordStore, settingsForAccount } from "../store.js";
import { buildWeeks } from "../weeks.js";
const now = new Date("2026-09-17T00:00:00+08:00");
const settings = { startDate: "2026-09-07", weekCount: 4 };
const course = (day, label, status = "pending") => ({ day, label, status, url: `https://attendance.monash.edu.my/student/Entry.aspx?s=1&d=${day}` });
const old = course("2026-09-07", "10:00 am FIT2102 Workshop 02", "success");
const current = course("2026-09-15", "4:00 pm FIT2102 Workshop 01");
const future = { day: "2026-09-18", label: "10:00 am FIT2109 Tutorial 03", status: "pending" };
const scan = { account: "one", semester: { start: "2026-09-07" }, courses: [old, current, future],
  days: Array.from({ length: 15 }, (_, i) => ({ value: `2026-09-${String(i + 6).padStart(2, "0")}` })) };

test("current-week snapshot replaces future patterns while preserving historical sessions", () => {
  const saved = mergeScan(null, scan, now);
  const model = buildWeeks(saved, settings, {}, now);
  assert.equal(model.weeks[0].rows[0].activity, "Workshop 02");
  assert.equal(model.weeks[0].rows[0].status, "success");
  assert.equal(model.weeks[1].rows.length, 2);
  assert.equal(model.weeks[2].rows.length, 2);
  assert.equal(model.weeks[2].rows.some(row => row.activity === "Workshop 02"), false);
  assert.equal(model.weeks[1].rows.find(row => row.date === "2026-09-18").canSubmit, false);
  assert.equal(model.weeks[2].rows.every(row => row.course === null), true);
  const changed = mergeScan(saved, { ...scan, courses: [future] }, now);
  assert.equal(changed.templateCourses.length, 1);
  assert.equal(changed.courses.some(item => item.label === old.label), true);
});

test("PASS is excluded by default and can be enabled without changing official rate", () => {
  const pass = course("2026-09-15", "1:00 pm FIT2102 PASS 01");
  const data = mergeScan(null, { ...scan, courses: [pass], overallRate: 79 }, now);
  const off = buildWeeks(data, settings, {}, now).weeks[1];
  assert.equal(off.status, "empty");
  assert.equal(off.rows[0].canSubmit, false);
  const on = buildWeeks(data, { ...settings, includePass: true }, {}, now).weeks[1];
  assert.equal(on.rows[0].canSubmit, true);
  assert.equal(data.overallRate, 79);
});

test("official tick overrides stale uncertain result and invalid codes can be retried before deadline only", () => {
  const data = mergeScan(null, scan, now);
  const row = buildWeeks(data, settings, {}, now).weeks[1].rows[0];
  const outcomes = { [row.key]: { status: "unavailable", attempted: true, retryable: true, text: "Invalid code" } };
  assert.equal(buildWeeks(data, settings, outcomes, now).weeks[1].rows[0].canSubmit, true);
  assert.equal(buildWeeks(data, settings, outcomes, new Date("2026-09-23")).weeks[1].rows[0].canSubmit, false);
  data.courses.find(item => item.day === current.day).status = "success";
  outcomes[row.key] = { status: "pending", uncertain: true, attempted: true };
  assert.equal(buildWeeks(data, settings, outcomes, now).weeks[1].rows[0].status, "success");
});

test("records persist across store instances and isolate accounts and semesters", async () => {
  let db = {};
  const storage = { async get(key) { return structuredClone({ [key]: db[key] }); }, async set(value) { db = structuredClone(value); } };
  const saved = mergeScan(null, scan, now);
  const key = recordKey(saved);
  await createRecordStore(storage).save(key, saved, { example: { status: "success" } });
  const reloaded = await createRecordStore(storage).load(key);
  assert.equal(reloaded.outcomes.example.status, "success");
  assert.equal(reloaded.schedule.courses.length, 3);
  assert.equal(await createRecordStore(storage).load(recordKey({ ...saved, account: "two" })), null);
  assert.notEqual(key, recordKey({ ...saved, semester: { start: "2027-01-01" } }));
});


test("calendar and PASS settings are isolated by account and semester and survive result saves", async () => {
  let db = {};
  const storage = { async get(key) { return structuredClone({ [key]: db[key] }); }, async set(value) { db = structuredClone(value); } };
  const store = createRecordStore(storage);
  const a = scan;
  const b = { ...scan, account: "two" };
  const calendar = { startDate: "2026-09-07", weekCount: 15, breakStart: "2026-10-05", includePass: true };
  await store.save(recordKey(a), a, {}, calendar);
  assert.deepEqual(settingsForAccount(a, await store.load(recordKey(a))), calendar);
  const defaults = settingsForAccount(b, await store.load(recordKey(b)));
  assert.equal(defaults.weekCount, 12);
  assert.equal(defaults.breakStart, "");
  assert.equal(defaults.includePass, false);
  await store.save(recordKey(b), b, {}, defaults);
  await store.save(recordKey(a), a, { done: { status: "success" } });
  assert.deepEqual(settingsForAccount(a, await store.load(recordKey(a))), calendar);
  const nextTerm = { ...a, semester: { start: "2027-02-01" } };
  assert.equal(settingsForAccount(nextTerm, await store.load(recordKey(nextTerm))).startDate, "2027-02-01");
});
