/** Demo: types only. The real module is server code that talks to the database and Cliniko. */
import type { Band, Priority, TaskRule, TaskSize } from "@/core/tasks";

export type TaskOut = {
  id: string;
  title: string;
  notes: string;
  assigneeId: string;
  assigneeName: string;
  createdBy: string;
  createdByName: string;
  size: TaskSize;
  priority: Priority;
  band: Band;
  position: number;
  dueDay: string | null;
  repeating: boolean;
  doneAt: string | null;
  droppedAt: string | null;
  createdAt: string;
};
export type TemplateOut = { id: string; title: string; notes: string; assigneeId: string; assigneeName: string; size: TaskSize; priority: Priority; rule: TaskRule; createdBy: string };
export type TaskPerson = { id: string; name: string; openPoints: number };
