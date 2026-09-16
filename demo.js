// This adapter runs only in the local preview. It never sends attendance requests.
export function createDemoAdapter() {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const today = new Date(`${format.format(new Date())}T00:00:00Z`);
  const day = 86400000;
  const monday = today.getTime() - ((today.getUTCDay() + 6) % 7) * day;
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const template = [
    { offset: 0, label: "2:00 pm FIT2014 Seminar 01-P1" },
    { offset: 0, label: "6:00 pm FIT2109 Workshop 01" },
    { offset: 1, label: "10:00 am FIT2014 Seminar 01-P2" },
    { offset: 1, label: "2:00 pm FIT2014 Applied 01" },
    { offset: 1, label: "4:00 pm FIT2102 Workshop 01" }
  ];
  const courses = [];
  for (const weekOffset of [-7, 0, 7]) {
    for (const [index, item] of template.entries()) {
      const date = iso(monday + (weekOffset + item.offset) * day);
      courses.push({ day: date, label: item.label, url: `demo:${date}:${index}`, icon: "question.png", status: "pending" });
    }
  }
  const schedule = {
    account: "demo", semester: { start: iso(monday - 49 * day), end: iso(monday + 41 * day) },
    days: Array.from({ length: 16 }, (_, index) => ({ value: iso(monday + (index - 7) * day), label: iso(monday + (index - 7) * day) })),
    selectedDay: iso(today.getTime()), courses
  };
  return {
    async connect() { return schedule; },
    async submit(course, code) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (code.toLowerCase() === "error") return { status: "unavailable", uncertain: false,
        text: "【模拟网页反馈】Invalid attendance code.\n签到码无效。" };
      if (code.toLowerCase() === "unknown") return { status: "pending", uncertain: true,
        text: "【模拟网页反馈】连接中断，无法确认是否提交成功。" };
      course.status = "success";
      return { status: "success", uncertain: false,
        text: `【模拟网页反馈】Attendance recorded successfully.\n${course.label}\n这是演示，没有发送真实签到请求。` };
    },
    async openSite() { window.open("https://attendance.monash.edu.my/student/", "_blank", "noopener"); }
  };
}
