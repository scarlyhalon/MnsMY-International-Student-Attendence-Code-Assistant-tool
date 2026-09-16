import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const pageSource = fs.readFileSync(new URL("../page.js", import.meta.url), "utf8");
const browserSource = fs.readFileSync(new URL("../browser.js", import.meta.url), "utf8");
const HOME = "https://attendance.monash.edu.my/student/";
const ENTRY = `${HOME}Entry.aspx?s=FIT2102-W&d=2026-09-15`;
const COURSE = { url: ENTRY, day: "2026-09-15", label: "FIT2102 Workshop" };
const SCHEDULE = { days: [{ value: COURSE.day, label: "15 September" }], courses: [COURSE], selectedDay: COURSE.day };

function pageFixture({ url = ENTRY, valid = true, inputPresent = true, formPresent = true, now = Date.now } = {}) {
  const calls = [];
  class Input extends EventTarget {
    get value() { return this.storedValue || ""; }
    set value(value) { this.storedValue = value; calls.push(["native-set", value]); }
  }
  const button = { disabled: false, click() { calls.push(["click"]); } };
  const form = {
    querySelector(selector) { assert.equal(selector, 'input[type="submit"][value="Submit"]'); return button; },
    checkValidity() { calls.push(["validate"]); return valid; },
    reportValidity() { calls.push(["report"]); }
  };
  const input = new Input();
  input.form = formPresent ? form : null;
  input.disabled = false;
  input.readOnly = false;
  for (const type of ["input", "change"]) input.addEventListener(type, event => calls.push([type, event.bubbles]));
  // An own accessor represents the overrides used by some page frameworks.
  Object.defineProperty(input, "value", { get() { return this.storedValue || ""; }, set() { throw new Error("own setter used"); } });
  let select = null;
  let anchors = [];
  let period = null;
  let account = null;
  const document = {
    getElementById(id) {
      if (id === "daySel") return select;
      if (id === "ctl00_ContentPlaceHolder1_periodBox") return period;
      if (id === "ctl00_ContentPlaceHolder1_userName") return account;
      return id === "ctl00_ContentPlaceHolder1_sessionCode" && inputPresent ? input : null;
    },
    querySelectorAll() { return anchors; },
    body: { innerText: "Original entry form" },
    readyState: "complete"
  };
  class Clock extends Date { static now() { return now(); } }
  const context = vm.createContext({ document, location: { href: url }, URL, HTMLInputElement: Input, Event, Date: Clock });
  vm.runInContext(pageSource.replaceAll("export function", "function") + "\nthis.api = { readSchedule, readSemester, submitAttendance, readPageResult, classifyAttendanceResult };", context);
  return { ...context.api, calls, input, button, document,
    period(text) { period = { textContent: text }; },
    account(text) { account = { textContent: text }; },
    schedule(days, links) {
      select = { options: days, value: days[0].value };
      anchors = links.map(([href, textContent, icon]) => ({ getAttribute() { return href; }, textContent,
        querySelector() { return icon ? { getAttribute() { return icon; } } : null; } }));
    }
  };
}

test("schedule preserves dates and rejects wrong origins, paths and dates while deduplicating course identities", () => {
  const page = pageFixture({ url: `${HOME}Units.aspx` });
  page.schedule([
    { value: "2026-09-15", textContent: " 15 September " },
    { value: "2026-09-16", textContent: "16 September" }
  ], [
    ["Entry.aspx?s=FIT2102-W&d=2026-09-15", " FIT2102 \n Workshop "],
    ["Entry.aspx?d=2026-09-15&s=FIT2102-W#duplicate", "duplicate"],
    ["Entry.aspx?s=FIT2014-T&d=2026-09-16", "FIT2014 Tutorial"],
    ["https://example.com/student/Entry.aspx?s=x&d=2026-09-15", "off origin"],
    ["/other/Entry.aspx?s=x&d=2026-09-15", "wrong path"],
    ["Entry.aspx?s=x&d=2099-01-01", "unknown date"],
    ["Entry.aspx?d=2026-09-15", "missing session"],
    ["http://[Entry.aspx", "malformed"]
  ]);
  const actual = JSON.parse(JSON.stringify(page.readSchedule()));
  assert.equal(actual.selectedDay, "2026-09-15");
  assert.equal(actual.days[0].label, "15 September");
  assert.deepEqual(actual.courses.map(({ day, label }) => ({ day, label })), [
    { day: "2026-09-15", label: "FIT2102 Workshop" },
    { day: "2026-09-16", label: "FIT2014 Tutorial" }
  ]);
});

test("schedule returns null when no course page is present", () => {
  assert.equal(pageFixture().readSchedule(), null);
});

test("schedule preserves observed school day strings and exposes icons without inferring success", () => {
  const page = pageFixture({ url: `${HOME}Units.aspx` });
  page.account(" Example Student ");
  page.schedule([{ value: "14_Sep_26", textContent: "14 September" }], [
    ["Entry.aspx?s=one&d=14_Sep_26", "2:00 pm FIT2014 Seminar 01-P1", "./img/question.png"],
    ["Entry.aspx?s=two&d=14_Sep_26", "4:00 pm FIT2102 Workshop", "./img/tick.png?version=1"]
  ]);
  const result = page.readSchedule();
  assert.equal(result.account, "Example Student");
  assert.equal(result.courses[0].day, "14_Sep_26");
  assert.equal(result.courses[0].icon, "question.png");
  assert.equal(result.courses[0].status, "pending");
  assert.equal(result.courses[1].icon, "tick.png");
  assert.equal(result.courses[1].status, "unknown");
});

test("semester reads only the observed period element and rejects impossible or reversed ranges", () => {
  const page = pageFixture();
  assert.equal(page.readSemester(), null);
  page.period("(27 Jul 2026 - 23 Oct 2026)");
  assert.deepEqual(JSON.parse(JSON.stringify(page.readSemester())), { start: "2026-07-27", end: "2026-10-23" });
  for (const text of ["31 Feb 2026 - 23 Oct 2026", "27 Jul 2026 - 23 Xxx 2026", "27 Jul 2026 - 23 Jun 2026", "not a period"]) {
    page.period(text);
    assert.equal(page.readSemester(), null);
  }
});

test("result classifier requires an explicit affirmative attendance record", () => {
  const { classifyAttendanceResult: classify } = pageFixture();
  for (const text of [
    "Attendance successfully recorded.", "Your attendance has been successfully registered!",
    "Your attendance has been recorded successfully for FIT2014.",
    "You have successfully registered your attendance.", "Attendance registration successful.",
    "Thank you!\nYour attendance has already been recorded."
  ]) assert.equal(classify(text), "success", text);
  for (const text of [
    "Your attendance has not been successfully recorded.", "Attendance wasn't successfully recorded.",
    "Invalid attendance code.", "Your attendance code has expired.", "Attendance is closed.",
    "Too late.", "Expired!", "Error.", "Attendance successfully recorded.\nInvalid code."
  ]) assert.equal(classify(text), "unavailable", text);
  for (const text of [
    "Overall attendance 100%", "Successfully submitted", "Attendance recorded?",
    "If your attendance has been successfully recorded, close this window.",
    "Please ensure your attendance has been recorded.", "Attendance will be recorded successfully.",
    "Class pending", "Your attendance has been unsuccessfully recorded.", "Code accepted", ""
  ]) assert.equal(classify(text), "pending", text);
});

test("submission requires exact nonempty course and date on the school origin", () => {
  for (const [currentUrl, expectedUrl] of [
    [ENTRY, ENTRY.replace("FIT2102-W", "FIT2014-T")],
    [ENTRY, ENTRY.replace("2026-09-15", "2026-09-16")],
    [ENTRY, ENTRY.replace("attendance.monash.edu.my", "example.com")],
    [`${HOME}Entry.aspx`, `${HOME}Entry.aspx`],
    [`${HOME}Entry.aspx?s=x`, `${HOME}Entry.aspx?s=x`],
    [`${HOME}Entry.aspx?d=2026-09-15`, `${HOME}Entry.aspx?d=2026-09-15`],
    [ENTRY, "broken URL"]
  ]) {
    const page = pageFixture({ url: currentUrl });
    assert.equal(page.submitAttendance({ expectedUrl, code: "1234" }).submitted, false);
    assert.deepEqual(page.calls, []);
  }
});

test("empty codes and unavailable form fields cannot click Submit", () => {
  for (const code of ["", " \n ", null, 123]) {
    const page = pageFixture();
    assert.equal(page.submitAttendance({ expectedUrl: ENTRY, code }).submitted, false);
    assert.deepEqual(page.calls, []);
  }
  for (const options of [{ inputPresent: false }, { formPresent: false }, { disabled: true }, { readOnly: true }, { buttonDisabled: true }]) {
    const page = pageFixture(options);
    if (options.disabled) page.input.disabled = true;
    if (options.readOnly) page.input.readOnly = true;
    if (options.buttonDisabled) page.button.disabled = true;
    assert.equal(page.submitAttendance({ expectedUrl: ENTRY, code: "1234" }).submitted, false);
    assert.deepEqual(page.calls, []);
  }
});

test("submission uses native setter, bubbling input/change events, and clicks once after validation", () => {
  const page = pageFixture();
  const result = page.submitAttendance({ expectedUrl: ENTRY, code: "  ABC123  " });
  assert.equal(result.submitted, true);
  assert.equal(result.beforeText, "Original entry form");
  assert.deepEqual(page.calls, [["native-set", "ABC123"], ["input", true], ["change", true], ["validate"], ["click"]]);
});

test("invalid original form reports validation and does not submit", () => {
  const page = pageFixture({ valid: false });
  assert.equal(page.submitAttendance({ expectedUrl: ENTRY, code: "1234" }).submitted, false);
  assert.deepEqual(page.calls, [["native-set", "1234"], ["input", true], ["change", true], ["validate"], ["report"]]);
});

test("in-page deadline permits the instant before cutoff and blocks cutoff, later and invalid values", () => {
  const deadline = "2026-09-22 14:00";
  const cutoff = Date.parse("2026-09-22T14:00:00+08:00");
  for (const [offset, expected] of [[-1, true], [0, false], [1, false]]) {
    const page = pageFixture({ now: () => cutoff + offset });
    const result = page.submitAttendance({ expectedUrl: ENTRY, code: "1234", deadline });
    assert.equal(result.submitted, expected);
    assert.equal(page.calls.filter(call => call[0] === "click").length, expected ? 1 : 0);
    if (!expected) assert.match(result.reason, /7天/);
  }
  for (const deadline of [null, "", "not a date", "2026-02-30 14:00", "2026-09-22 24:00", "2026-09-22 14:60"]) {
    const page = pageFixture({ now: () => cutoff - 1 });
    const result = page.submitAttendance({ expectedUrl: ENTRY, code: "1234", deadline });
    assert.equal(result.submitted, false);
    assert.match(result.reason, /期限无效/);
    assert.equal(page.calls.length, 0);
  }
});

test("in-page deadline is rechecked immediately before clicking", () => {
  const cutoff = Date.parse("2026-09-22T14:00:00+08:00");
  let current = cutoff - 1;
  const page = pageFixture({ now: () => current });
  page.input.addEventListener("change", () => { current = cutoff; });
  const result = page.submitAttendance({ expectedUrl: ENTRY, code: "1234", deadline: "2026-09-22 14:00" });
  assert.equal(result.submitted, false);
  assert.match(result.reason, /7天/);
  assert.equal(page.calls.filter(call => call[0] === "click").length, 0);
});

function adapterFixture({ submitError = false, unchanged = false, submitted = true,
  beforeText = "Original entry form", resultText = "Invalid attendance code", now = Date.now,
  onEntryReady = () => {} } = {}) {
  const calls = [];
  let current = { id: 1, windowId: 2, url: `${HOME}Units.aspx`, status: "complete" };
  let queuedTabs = [];
  let resultReads = 0;
  const chrome = {
    tabs: {
      async query() { return [current]; },
      async get() {
        if (queuedTabs.length) current = queuedTabs.shift();
        if (current.url === ENTRY && current.status === "complete") onEntryReady();
        calls.push(["get", current.url, current.status]); return current;
      },
      async update(id, changes) {
        calls.push(["navigate", changes.url]);
        if (changes.url) queuedTabs = [
          current, { ...current, url: changes.url, status: "loading" },
          { ...current, url: changes.url, status: "complete" }
        ];
        return current;
      }
    },
    scripting: {
      async executeScript({ func, args }) {
        calls.push(["script", func.name, args]);
        if (func.name === "readSchedule") return [{ result: SCHEDULE }];
        if (func.name === "readSemester") return [{ result: { start: "2026-07-27", end: "2026-10-23" } }];
        if (func.name === "submitAttendance") {
          assert.equal(current.url, ENTRY);
          assert.equal(current.status, "complete");
          if (submitError) throw new Error("document navigated");
          return [{ result: { submitted, beforeText, reason: "网页课次与所选课程不一致" } }];
        }
        resultReads++;
        const text = Array.isArray(resultText) ? resultText[Math.min(resultReads - 2, resultText.length - 1)] : resultText;
        return [{ result: { url: ENTRY, ready: true, text: unchanged || resultReads === 1 ? beforeText : text } }];
      }
    }
  };
  class Clock extends Date { static now() { return now(); } }
  const context = vm.createContext({ chrome, URL, Date: Clock, readSchedule() {}, readSemester() {}, submitAttendance() {}, readPageResult() {},
    classifyAttendanceResult: pageFixture().classifyAttendanceResult, setTimeout(fn) { queueMicrotask(fn); } });
  vm.runInContext(browserSource.replace(/^import.*\r?\n/, "").replace("export function", "function") + "\nthis.adapter = createBrowserAdapter();", context);
  return { adapter: context.adapter, calls, setCurrent(url) { current = { ...current, url, status: "complete" }; queuedTabs = []; } };
}

test("connect reads the semester and navigates to fresh Units on every request", async () => {
  const { adapter, calls } = adapterFixture();
  const result = await adapter.connect();
  assert.deepEqual(JSON.parse(JSON.stringify(result.semester)), { start: "2026-07-27", end: "2026-10-23" });
  await adapter.connect();
  assert.deepEqual(calls.filter(call => call[0] === "navigate").map(call => call[1]), [
    `${HOME}AttendanceInfo.aspx`, `${HOME}Units.aspx`, `${HOME}AttendanceInfo.aspx`, `${HOME}Units.aspx`
  ]);
});

test("adapter waits past stale and loading tabs before injecting into the selected course", async () => {
  const { adapter, calls } = adapterFixture();
  await adapter.connect();
  const response = await adapter.submit(COURSE, "1234");
  assert.equal(response.status, "unavailable");
  assert.equal(response.uncertain, false);
  assert.equal(response.text, "Invalid attendance code");
  const submitIndex = calls.findIndex(call => call[0] === "script" && call[1] === "submitAttendance");
  assert.deepEqual(calls[submitIndex - 1], ["get", ENTRY, "complete"]);
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "submitAttendance").length, 1);
});

test("adapter rejects invalid course URLs and empty codes before navigation", async () => {
  const { adapter, calls } = adapterFixture();
  await adapter.connect();
  calls.length = 0;
  for (const course of [
    { ...COURSE, url: ENTRY.replace("attendance.monash.edu.my", "example.com") },
    { ...COURSE, url: `${HOME}Entry.aspx` },
    { ...COURSE, day: "2026-09-16" }
  ]) await assert.rejects(adapter.submit(course, "1234"));
  await assert.rejects(adapter.submit(COURSE, "  "));
  assert.equal(calls.filter(call => call[0] === "navigate").length, 0);
});

test("adapter uses an already-loaded matching course without a same-document reload race", async () => {
  const { adapter, calls, setCurrent } = adapterFixture();
  await adapter.connect();
  setCurrent(ENTRY);
  calls.length = 0;
  await adapter.submit(COURSE, "1234");
  assert.equal(calls.filter(call => call[0] === "navigate").length, 0);
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "submitAttendance").length, 1);
});

test("interrupted submission stays uncertain and never retries automatically", async () => {
  const { adapter, calls } = adapterFixture({ submitError: true });
  await adapter.connect();
  const response = await adapter.submit(COURSE, "1234");
  assert.equal(response.uncertain, true);
  assert.equal(response.status, "pending");
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "submitAttendance").length, 1);
});

test("unchanged webpage never becomes a success claim after polling", async () => {
  const { adapter, calls } = adapterFixture({ unchanged: true });
  await adapter.connect();
  const response = await adapter.submit(COURSE, "1234");
  assert.equal(response.uncertain, true);
  assert.equal(response.status, "pending");
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "submitAttendance").length, 1);
});

test("known submit guard failures return unavailable without polling or retrying", async () => {
  const { adapter, calls } = adapterFixture({ submitted: false });
  await adapter.connect();
  const response = await adapter.submit(COURSE, "1234");
  assert.equal(response.status, "unavailable");
  assert.equal(response.uncertain, false);
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "readPageResult").length, 0);
});

test("only fresh affirmative feedback establishes success; old affirmative text is ignored", async () => {
  for (const [beforeText, resultText, expected] of [
    ["Original entry form", "Your attendance has been successfully recorded.", "success"],
    ["Attendance successfully recorded.\nOld timer", "Attendance successfully recorded.\nNew timer", "pending"],
    ["Original entry form", "Your attendance has not been successfully recorded.", "unavailable"],
    ["Original entry form", "Overall attendance 100%", "pending"]
  ]) {
    const { adapter } = adapterFixture({ beforeText, resultText });
    await adapter.connect();
    const result = await adapter.submit(COURSE, "1234");
    assert.equal(result.status, expected);
    assert.equal(result.uncertain, expected === "pending");
  }
});

test("an intermediate changed page keeps polling for explicit feedback", async () => {
  const { adapter, calls } = adapterFixture({ resultText: ["Processing attendance…", "Attendance successfully recorded."] });
  await adapter.connect();
  const result = await adapter.submit(COURSE, "1234");
  assert.equal(result.status, "success");
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "readPageResult").length, 3);
});

test("adapter deadline blocks at cutoff and invalid dates, and passes a valid deadline to the page", async () => {
  const deadline = "2026-09-22 14:00";
  const cutoff = Date.parse("2026-09-22T14:00:00+08:00");
  for (const [provided, now, shouldInject] of [
    [deadline, cutoff - 1, true], [deadline, cutoff, false], [deadline, cutoff + 1, false],
    ["2026-02-30 14:00", cutoff - 1, false], [null, cutoff - 1, false], ["", cutoff - 1, false]
  ]) {
    const { adapter, calls } = adapterFixture({ now: () => now });
    await adapter.connect();
    const result = await adapter.submit({ ...COURSE, deadline: provided }, "1234");
    const injections = calls.filter(call => call[0] === "script" && call[1] === "submitAttendance");
    assert.equal(injections.length, shouldInject ? 1 : 0);
    if (shouldInject) assert.equal(injections[0][2][0].deadline, deadline);
    else { assert.equal(result.status, "unavailable"); assert.equal(result.uncertain, false); }
  }
});

test("adapter checks time after navigation finishes", async () => {
  const cutoff = Date.parse("2026-09-22T14:00:00+08:00");
  let current = cutoff - 1;
  const { adapter, calls } = adapterFixture({ now: () => current, onEntryReady: () => { current = cutoff; } });
  await adapter.connect();
  const result = await adapter.submit({ ...COURSE, deadline: "2026-09-22 14:00" }, "1234");
  assert.equal(result.status, "unavailable");
  assert.match(result.text, /7天/);
  assert.equal(calls.filter(call => call[0] === "script" && call[1] === "submitAttendance").length, 0);
});
