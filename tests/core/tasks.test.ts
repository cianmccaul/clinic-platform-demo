import { test } from "vitest";
import assert from "node:assert/strict";
import { irishBankHolidays, isWorkingDay, occurrences, openWeekLoad, percent, promotedBand, ruleLabel, treeStage, weekPoints, weekday } from "../../core/tasks.ts";

test("REQ-TASK-001 Irish bank holidays, with days off for weekend ones", () => {
  const h = [...irishBankHolidays(2026)].sort();
  assert.deepEqual(h, ["2026-01-01", "2026-02-02", "2026-03-17", "2026-04-06", "2026-05-04", "2026-06-01", "2026-08-03", "2026-10-26", "2026-12-25", "2026-12-26", "2026-12-28"]);
  assert.ok(irishBankHolidays(2030).has("2030-02-01"), "St Brigid's: 1 Feb when it's a Friday");
  assert.ok(irishBankHolidays(2027).has("2027-02-01"));
  assert.equal(isWorkingDay("2026-10-26"), false);
  assert.equal(isWorkingDay("2026-10-27"), true);
  assert.equal(weekday("2026-10-19"), 0);
});

test("REQ-TASK-002 payroll on the 29th: last day of short months, previous working day at weekends and bank holidays", () => {
  const r = { kind: "monthly" as const, day: 29 };
  assert.deepEqual(occurrences(r, "2026-10-01", "2026-12-31"), ["2026-10-29", "2026-11-27", "2026-12-29"]);
  assert.deepEqual(occurrences(r, "2027-02-01", "2027-02-28"), ["2027-02-26"], "28 Feb 2027 is a Sunday");
  assert.deepEqual(occurrences({ kind: "monthly", day: 31 }, "2026-04-01", "2026-04-30"), ["2026-04-30"]);
  assert.deepEqual(occurrences({ kind: "weekly", weekday: 0 }, "2026-10-19", "2026-11-02"), ["2026-10-19", "2026-10-23", "2026-11-02"], "bank holiday Monday 26 Oct moves to Friday 23");
  assert.equal(ruleLabel(r), "Monthly on the 29th");
  assert.equal(ruleLabel({ kind: "monthly", day: 1 }), "Monthly on the 1st");
  assert.equal(ruleLabel({ kind: "weekly", weekday: 4 }), "Every Friday");
});

test("REQ-TASK-003 due tasks move up to Today or This week, never down", () => {
  const tue = "2026-10-20";
  assert.equal(promotedBand("later", "2026-10-21", tue), "today", "due tomorrow");
  assert.equal(promotedBand("later", "2026-10-19", tue), "today", "overdue");
  assert.equal(promotedBand("later", "2026-10-23", tue), "week", "due Friday");
  assert.equal(promotedBand("later", "2026-11-20", tue), "later");
  assert.equal(promotedBand("week", "2026-11-20", tue), "week", "never moved down");
  assert.equal(promotedBand("later", null, tue), "later");
  assert.equal(promotedBand("later", "2026-10-27", "2026-10-24"), "today", "on the Saturday before the bank holiday, Tuesday is the next working day");
});

test("REQ-TASK-004 weekly progress, tree stages and the long-list nudge", () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const tasks = [
    { points: 2, band: "week" as const, dueDay: null, doneAt: "2026-10-20T10:00:00Z", droppedAt: null },
    { points: 4, band: "today" as const, dueDay: null, doneAt: null, droppedAt: null },
    { points: 1, band: "later" as const, dueDay: "2026-10-25", doneAt: null, droppedAt: null }, // due Sunday: counts
    { points: 4, band: "later" as const, dueDay: null, doneAt: null, droppedAt: null }, // later: doesn't
    { points: 2, band: "week" as const, dueDay: null, doneAt: null, droppedAt: "2026-10-20T09:00:00Z" }, // dropped
    { points: 1, band: "week" as const, dueDay: null, doneAt: "2026-10-16T10:00:00Z", droppedAt: null }, // last week
  ];
  const p = weekPoints(tasks, "2026-10-19", dayOf);
  assert.deepEqual(p, { done: 2, total: 7 });
  assert.equal(percent(p), 29);
  assert.equal(percent({ done: 0, total: 0 }), 0);
  assert.equal(treeStage(0), 1, "every week starts as a sprout");
  assert.equal(treeStage(29), 2);
  assert.equal(treeStage(99), 5);
  assert.equal(treeStage(100), 6);
  assert.equal(openWeekLoad(tasks), 4);
});
