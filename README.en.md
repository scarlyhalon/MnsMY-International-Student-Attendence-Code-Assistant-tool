[简体中文](README.md) | **English**

# Attendance Helper

A personal Chrome extension for Monash Malaysia students. Sign in to the school attendance website, enter the codes provided by your teachers, and submit the filled classes together.

This is an independent learning project built with help from Codex, **not an official Monash product**. No development environment or build step is needed to use the extension.

[Download the latest ZIP](https://github.com/scarlyhalon/MnsMY-International-Student-Attendence-Code-Assistant-tool/releases/latest/download/attendance-helper.zip) · [All releases](https://github.com/scarlyhalon/MnsMY-International-Student-Attendence-Code-Assistant-tool/releases)

## Install

1. Download the ZIP above and extract it into a folder you intend to keep.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Click **Attendance Helper** in the browser toolbar to open the semester view.

To update, download the new ZIP, replace the files in the same folder, then click **Reload** on the extension card. Avoid uninstalling the extension if you want to keep its local records.

## Language

The interface defaults to **English**. Use the **中文 / English** button in the header to switch languages. The preference is saved locally for this browser profile, independently of your school account and semester settings.

Switching languages preserves entered codes and the expanded weeks. The switch is disabled while a submission batch is running. Course names and feedback from the school website retain their original wording.

## Use

1. Open the [school attendance website](https://attendance.monash.edu.my/student/) in the same Chrome profile and sign in normally.
2. Click **Connect to school website** in the extension. It reads your account, semester dates, recent classes and available attendance entries.
3. Set the first day of **Week 1**, the number of teaching weeks (1–52), and an optional **mid-semester break** start date. Click **Save semester settings**. The break lasts seven days and does not count as a teaching week.
4. Expand a week and enter each teacher-provided code beside the corresponding class.
5. Click **Submit entered codes** once. Blank entries are skipped; filled classes are submitted sequentially through the school's original forms.
6. Read each result. Incorrect codes can be edited and submitted again while the class remains available. Unconfirmed results are not automatically retried; check the school website before taking further action.

An ordinary failure or unconfirmed result does not stop the remaining classes. If the account changes, expires or cannot be verified, the batch stops and entered codes are cleared. Reconnect before continuing.

## Weekly timetable and status

Each connection scans all dates available on the school page, including completed and upcoming classes without submission links. The current Monday–Sunday timetable, using Malaysia time, is copied into the current and future teaching weeks. Previously read historical records are retained rather than overwritten with the new timetable.

The extension uses a seven-day deadline from the class start time: the same weekday and time the following week, in Malaysia time (UTC+08:00). A mid-semester break does not extend this deadline. This rule was supplied by the project user; the actual school entry must also be available for submission.

| Indicator | Meaning |
| --- | --- |
| `?` | Pending, not yet open, or result unconfirmed |
| Orange `!` | An incorrect code needs correction and the class is still available |
| Red `×` | A class is unavailable or has failed; this is not an official absence determination |
| Green `✓` | All included classes in the week have confirmed completion |
| `–` | No included classes requiring attendance |

If a week contains both an unavailable class and a correctable code, its header shows the red cross. Expired classes are disabled and greyed out; other available classes remain editable. Completed classes stay visible. Missing historical records are labelled **History not loaded**.

The extension never substitutes another week's attendance link for a missing entry.

## Overall attendance and PASS

- The overall percentage comes directly from the school homepage, not an average calculated by the extension. It refreshes on connection and after batch processing.
- Below 80%, the number turns red and a link to [AskMira](https://askmira.monash.edu.my/) appears. If the percentage cannot be read, the interface shows **Not loaded**.
- Classes containing the standalone word `PASS` are visible but excluded from assisted attendance by default. Enable **Include PASS classes** if you need to submit them. This switch does not change the official percentage.

## Local records and multiple accounts

Timetables, per-class results, semester dates, teaching-week counts, break dates and the PASS setting are stored locally, separately for each school display name and semester. Reconnecting to the same account restores its records. New accounts default to the school's semester start date, 12 teaching weeks, no break and PASS excluded.

The school pages currently provide a display name rather than a reliable unique account ID, so different accounts with identical display names cannot be reliably distinguished. Older shared settings without account ownership are not automatically assigned to an account.

## Privacy and limitations

- The extension requests `scripting`, `storage`, and access to `https://attendance.monash.edu.my/*`.
- It uses your existing signed-in school session. It does not read cookie values, save school passwords, or send records to an additional server.
- Attendance codes remain in page memory and are not saved in local records. Clearing extension data or uninstalling removes saved records.
- The extension verifies the account before each submission. Entry pages without a displayed name use a fresh server account check; an explicit mismatch still stops the batch.
- School layout changes may require an extension update. An overall percentage alone cannot prove a specific class was completed or reconstruct missing history.
- Batch processing is sequential. School navigation and network delays still apply; unfamiliar feedback can take about four seconds of polling before checking the class list.
- Automated checks cover timetable rules, record isolation, account guards and simulated submissions. The school's records remain the source of truth.

## Try the preview

In a source checkout, open `preview.html`. It contains sample classes and cannot send real attendance requests.

- Enter ordinary text to simulate success.
- Enter `error` to simulate an incorrect code.
- Enter `unknown` to simulate an unconfirmed result while continuing the batch.

The install ZIP does not include the preview. Developers can regenerate it with `npm run preview`.

## Development and releases

The release workflow uses Node.js 22 and Python 3.12. No dependency installation is needed for the existing tests or packaging scripts.

```sh
npm test
npm run preview
python tools/package-release.py
```

These commands run the tests, regenerate the standalone preview, and build `dist/attendance-helper.zip` respectively.

A push of a `v*` tag triggers the GitHub Actions release workflow. The tag must match `manifest.json` (for example, `v0.3.4` for version `0.3.4`). The workflow tests the code, builds the ZIP and publishes a GitHub Release. A normal branch push alone does not publish a release.

| File | Purpose |
| --- | --- |
| `manifest.json`, `background.js` | Extension configuration and entry point |
| `app.html`, `app.css`, `app.js` | Semester interface and submission queue |
| `i18n.js` | English translations and saved language preference |
| `weeks.js` | Teaching weeks, deadlines and status aggregation |
| `store.js` | Account- and semester-scoped local records |
| `browser.js`, `page.js` | School-page reading, account checks and original-form submission |
| `demo.js` | Preview data and simulated feedback |

## Recent changes

- **v0.3.4:** English by default, a persistent English/Chinese switch, and this English README.
- **v0.3.3:** Incorrect codes that can still be corrected show an orange warning instead of being treated as unavailable.
- **v0.3.2:** Fixed account verification on entry pages that omit the student's name.
- **v0.3.1:** Isolated settings and records by account and semester, with account-change guards during submission.
