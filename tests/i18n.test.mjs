import test from "node:test";
import assert from "node:assert/strict";
import { t, getLanguage, setLanguage, loadLanguage, saveLanguage, staticTranslations } from "../i18n.js";

test("language defaults to English, persists separately, and handles unavailable storage", async () => {
  const values = { accountRecords: { student: "unchanged" } };
  const storage = { async get(key) { return { [key]: values[key] }; }, async set(update) { Object.assign(values, update); } };
  assert.equal(await loadLanguage(storage), "en");
  await saveLanguage(storage, "zh-CN");
  setLanguage("en");
  assert.equal(await loadLanguage(storage), "zh-CN");
  assert.deepEqual(values.accountRecords, { student: "unchanged" });
  assert.equal(await loadLanguage({ async get() { throw new Error("unavailable"); } }), "en");
  setLanguage("unsupported");
  assert.equal(getLanguage(), "en");
});

test("dynamic status and multiline feedback translate without changing unfamiliar school text", () => {
  setLanguage("en");
  assert.equal(t("提交已填写的签到码 (2)"), "Submit entered codes (2)");
  assert.equal(t("待完成 · 1/7"), "Pending · 1/7");
  assert.equal(t("学校日期范围：2026-09-21 — 2026-10-06。签到截止：下一周同一天、同一上课时间（马来西亚时间）。 Mid break：从 2026-10-01 起 7 天，不计入教学周。"), "School date range: 2026-09-21 — 2026-10-06. Deadline: the same class start time next week (Malaysia time). Mid-semester break: 7 days from 2026-10-01, excluded from teaching weeks.");
  const raw = "FIT2102 Tutorial 07\n签到码错误，需要修正\nInvalid attendance code.\nSchool reference: 中文原文 $&";
  assert.equal(t(raw), "FIT2102 Tutorial 07\nIncorrect code; correction needed\nInvalid attendance code.\nSchool reference: 中文原文 $&");
  setLanguage("zh-CN");
  assert.equal(t(raw), raw);
});

test("static translations switch repeatedly without replacing controls or their values", () => {
  const label = { nodeType: 3, textContent: "  学期设置  " };
  const input = { nodeType: 1, tagName: "INPUT", value: "KEEP-CODE", childNodes: [], getAttribute() { return null; } };
  const root = { childNodes: [label, input] };
  const apply = staticTranslations(root);
  setLanguage("en"); apply();
  assert.equal(label.textContent, "  Semester settings  ");
  setLanguage("zh-CN"); apply();
  assert.equal(label.textContent, "  学期设置  ");
  setLanguage("en"); apply();
  assert.equal(label.textContent, "  Semester settings  ");
  assert.equal(root.childNodes[1], input);
  assert.equal(input.value, "KEEP-CODE");
});

test("standalone preview preserves translation regexes when embedding JavaScript", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../i18n.js", import.meta.url), "utf8");
  const preview = await readFile(new URL("../preview.html", import.meta.url), "utf8");
  assert.ok(preview.includes(source.replace(/^export /gm, "")), "Bundling must not expand JavaScript dollar replacement patterns");
});
