import { schoolDate } from "./weeks.js";

export const recordKey = schedule => JSON.stringify([schedule.account, schedule.semester?.start || "unknown"]);
export function mergeScan(previous, next, now = new Date()) {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const monday = date.toISOString().slice(0, 10);
  const end = new Date(date.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const current = next.courses.filter(course => {
    const day = schoolDate(course.day); return day >= monday && day < end;
  });
  const courses = new Map();
  for (const course of previous?.courses || []) {
    if (schoolDate(course.day) < monday) courses.set(`${schoolDate(course.day)}|${course.label}`, course);
  }
  for (const course of next.courses) courses.set(`${schoolDate(course.day)}|${course.label}`, course);
  return { ...next, courses: [...courses.values()], snapshotMode: true, templateFrom: monday,
    templateCourses: current.map(({ day, label }) => ({ day, label })), scannedAt: now.toISOString() };
}

export function createRecordStore(storage) {
  return {
    async load(key) { return (await storage.get("attendanceRecords" )).attendanceRecords?.[key] || null; },
    async save(key, schedule, outcomes) {
      if (!schedule.account) return;
      const records = (await storage.get("attendanceRecords")).attendanceRecords || {};
      records[key] = { schedule, outcomes, updatedAt: new Date().toISOString() };
      await storage.set({ attendanceRecords: records });
    }
  };
}
