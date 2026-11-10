import { test } from "vitest";
import assert from "node:assert/strict";
import {
  byWeek,
  clock,
  clockLabel,
  duration,
  entryProblems,
  overlapping,
  parseClock,
  payableMinutes,
  timesheetRefusal,
  toCsv,
  totals,
  weekOf,
  type EntryInput,
} from "../../core/timesheets.ts";

const e = (over: Partial<EntryInput> = {}): EntryInput => ({ type: "worked", day: "2026-10-09", startMin: 675, endMin: 915, breakMin: 0, notes: "", ...over });

test("REQ-TS-001 payable time is end minus start minus the unpaid break, shown like Jane", () => {
  assert.equal(payableMinutes(e()), 240); // 11:15am–3:15pm = 4h 00m
  assert.equal(payableMinutes(e({ endMin: 925 })), 250); // 3:25pm = 4h 10m
  assert.equal(payableMinutes(e({ breakMin: 30 })), 210);
  assert.equal(payableMinutes(e({ endMin: null })), 0, "still clocked in counts nothing yet");
  assert.equal(duration(250), "4h 10m");
  assert.equal(clockLabel(675), "11:15am");
  assert.equal(clockLabel(0), "12:00am");
  assert.equal(clockLabel(720), "12:00pm");
  assert.equal(parseClock("9:05"), 545);
  assert.equal(parseClock("24:00"), null);
  assert.equal(clock(545), "09:05");
});

test("REQ-TS-002 entries are checked: real times, end after start, no shift past midnight or over 16h, no worked time in the future", () => {
  const today = "2026-10-12";
  assert.deepEqual(entryProblems(e(), today), []);
  assert.match(entryProblems(e({ endMin: 600 }), today).join(), /after the start/);
  assert.match(entryProblems(e({ startMin: 60, endMin: 1439 }), today).join(), /16 hours/);
  assert.match(entryProblems(e({ day: "2026-10-13" }), today).join(), /hasn't happened/);
  assert.deepEqual(entryProblems(e({ type: "annual_leave", day: "2026-12-24" }), today), [], "leave can be booked ahead");
  assert.match(entryProblems(e({ breakMin: 240 }), today).join(), /as long as the shift/);
  assert.match(entryProblems(e({ day: "2026-02-30" }), today).join(), /date/);
  assert.match(entryProblems(e({ notes: "x".repeat(501) }), today).join(), /500/);
});

test("REQ-TS-003 overlapping entries on the same day are flagged", () => {
  const a = { id: "a", day: "2026-10-09", startMin: 600, endMin: 720 };
  assert.equal(overlapping({ id: "b", day: "2026-10-09", startMin: 700, endMin: 800 }, [a]).length, 1);
  assert.equal(overlapping({ id: "b", day: "2026-10-09", startMin: 720, endMin: 800 }, [a]).length, 0, "back to back is fine");
  assert.equal(overlapping({ id: "b", day: "2026-10-10", startMin: 600, endMin: 720 }, [a]).length, 0);
  assert.equal(overlapping({ ...a }, [a]).length, 0, "an entry doesn't overlap itself");
});

test("REQ-TS-004 weeks start on Monday and total their entries; totals split worked from leave", () => {
  assert.equal(weekOf("2026-10-11"), "2026-10-05"); // Sunday → Monday before
  assert.equal(weekOf("2026-10-12"), "2026-10-12");
  const weeks = byWeek([e({ day: "2026-10-09" }), e({ day: "2026-10-12", startMin: 540, endMin: 600 }), e({ day: "2026-10-05" })]);
  assert.deepEqual(
    weeks.map((w) => [w.monday, w.totalMin]),
    [
      ["2026-10-12", 60],
      ["2026-10-05", 480],
    ]
  );
  const t = totals([
    { userId: "u", ...e() },
    { userId: "u", ...e({ type: "sick" }) },
  ]);
  assert.equal(t.get("u")?.totalMin, 480);
  assert.equal(t.get("u")?.byType.sick, 240);
});

test("REQ-TS-005 only your own timesheets, unless you're reception, an owner or a super admin; only for people who have them", () => {
  const me = { id: "c", seeAll: false, enabled: true };
  assert.equal(timesheetRefusal({ actor: me, ownerId: "c", ownerEnabled: true }), null);
  assert.match(timesheetRefusal({ actor: me, ownerId: "l", ownerEnabled: true }) ?? "", /only see your own/);
  assert.match(timesheetRefusal({ actor: { ...me, enabled: false }, ownerId: "c", ownerEnabled: false }) ?? "", /aren't switched on/);
  const rec = { id: "r", seeAll: true, enabled: false };
  assert.equal(timesheetRefusal({ actor: rec, ownerId: "l", ownerEnabled: true }), null);
  assert.match(timesheetRefusal({ actor: rec, ownerId: "x", ownerEnabled: false }) ?? "", /that person/);
});

test("REQ-TS-006 the CSV opens in a spreadsheet and can't smuggle in formulas", () => {
  const csv = toCsv([{ name: "Cian McCaul", ...e({ notes: '=HYPERLINK("x")' }) }]);
  const [head, line] = csv.trim().split("\r\n");
  assert.match(head, /"Name","Date","Type","Start","End","Unpaid break \(min\)","Payable \(h:mm\)","Payable \(hours\)","Notes"/);
  assert.equal(line, `"Cian McCaul","2026-10-09","Worked","11:15","15:15","0","4:00","4.00","'=HYPERLINK(""x"")"`);
});
