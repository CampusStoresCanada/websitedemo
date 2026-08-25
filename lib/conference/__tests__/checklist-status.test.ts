import { describe, expect, it } from "vitest";
import { classifyPersonTasks, summarizePersonTasks } from "../checklist-status";

const HOTEL = {
  id: "t-hotel",
  name: "Book your hotel room",
  description: "",
  sort_order: 1,
  deadline: "2027-01-08",
  checklistName: "Your Conference",
};
const DIETARY = {
  id: "t-diet",
  name: "Tell us your dietary needs",
  description: "",
  sort_order: 2,
  deadline: null,
  checklistName: "Your Conference",
};

const person = (id: string, org = "Acme", fields: Record<string, unknown> = {}) => ({
  personId: id,
  name: `Person ${id}`,
  organizationName: org,
  fields,
});

describe("summarizePersonTasks", () => {
  it("counts a confirmation code we already hold as done without anyone ticking", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("a", "Acme", { hotel_confirmation_code: "ABC123" })],
      []
    );
    expect(task.done).toBe(1);
    expect(task.derived).toBe(1);
    expect(task.pending).toBe(0);
    expect(task.outstanding).toEqual([]);
  });

  it("ignores a blank confirmation code", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("a", "Acme", { hotel_confirmation_code: "   " })],
      []
    );
    expect(task.done).toBe(0);
    expect(task.pending).toBe(1);
  });

  it("never puts someone staying elsewhere in the chase list", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("a"), person("b")],
      [{ task_id: "t-hotel", person_id: "a", state: "not_applicable" }]
    );
    expect(task.notApplicable).toBe(1);
    expect(task.pending).toBe(1);
    expect(task.outstanding.map((p) => p.personId)).toEqual(["b"]);
  });

  it("treats a captured code as winning over a stale acknowledgement", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("a", "Acme", { hotel_confirmation_code: "ABC123" })],
      [{ task_id: "t-hotel", person_id: "a", state: "pending" }]
    );
    expect(task.done).toBe(1);
    expect(task.pending).toBe(0);
  });

  it("counts an explicit done that has no captured field behind it", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("a")],
      [{ task_id: "t-hotel", person_id: "a", state: "done" }]
    );
    expect(task.done).toBe(1);
    expect(task.derived).toBe(0);
  });

  it("does not let one task's answer satisfy another", () => {
    const [hotel, diet] = summarizePersonTasks(
      [HOTEL, DIETARY],
      [person("a")],
      [{ task_id: "t-hotel", person_id: "a", state: "done" }]
    );
    expect(hotel.pending).toBe(0);
    expect(diet.pending).toBe(1);
  });

  it("only derives for the task the field is mapped to", () => {
    const [, diet] = summarizePersonTasks(
      [HOTEL, DIETARY],
      [person("a", "Acme", { hotel_confirmation_code: "ABC123" })],
      []
    );
    expect(diet.done).toBe(0);
    expect(diet.pending).toBe(1);
  });

  it("puts the soonest deadline first and sinks undated tasks", () => {
    const names = summarizePersonTasks([DIETARY, HOTEL], [], []).map((t) => t.name);
    expect(names).toEqual(["Book your hotel room", "Tell us your dietary needs"]);
  });

  it("sorts the chase list by organisation then person", () => {
    const [task] = summarizePersonTasks(
      [HOTEL],
      [person("c", "Zeta"), person("a", "Acme"), person("b", "Acme")],
      []
    );
    expect(task.outstanding.map((p) => `${p.organizationName}/${p.personId}`)).toEqual([
      "Acme/a",
      "Acme/b",
      "Zeta/c",
    ]);
  });

  it("reports zeroes rather than failing when nobody is registered", () => {
    const [task] = summarizePersonTasks([HOTEL], [], []);
    expect(task).toMatchObject({ done: 0, pending: 0, notApplicable: 0 });
  });
});

describe("classifyPersonTasks", () => {
  const personTask = (id: string, name: string, active = true) => ({
    id, name, description: "", sort_order: 1, active, audience: "person",
  });
  const orgTask = (id: string, name: string, active = true) => ({
    id, name, description: "", sort_order: 1, active, audience: "org",
  });

  it("asks about a live task on a live checklist", () => {
    const { tasks, inactive } = classifyPersonTasks([
      { name: "Your Conference", active: true, deadline_at: "2027-01-08",
        tasks: [personTask("t1", "Book your hotel room")] },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].checklistName).toBe("Your Conference");
    expect(inactive).toEqual([]);
  });

  it("reports a switched-off checklist as the checklist's fault", () => {
    const { tasks, inactive } = classifyPersonTasks([
      { name: "Your Conference", active: false, deadline_at: null,
        tasks: [personTask("t1", "Book your hotel room")] },
    ]);
    expect(tasks).toEqual([]);
    expect(inactive).toEqual([{ name: "Book your hotel room", reason: "checklist_off" }]);
  });

  it("reports a task switched off inside a live checklist as the task's fault", () => {
    // The state that made this distinction necessary: after the Exhibitor
    // merge, a live checklist can carry individually disabled tasks, and
    // "make the checklist active" would be the wrong instruction.
    const { tasks, inactive } = classifyPersonTasks([
      { name: "Exhibitor", active: true, deadline_at: null,
        tasks: [personTask("t1", "Book your hotel room", false)] },
    ]);
    expect(tasks).toEqual([]);
    expect(inactive).toEqual([{ name: "Book your hotel room", reason: "task_off" }]);
  });

  it("blames the checklist when both are off, since the task alone cannot fix it", () => {
    const { inactive } = classifyPersonTasks([
      { name: "Your Conference", active: false, deadline_at: null,
        tasks: [personTask("t1", "Book your hotel room", false)] },
    ]);
    expect(inactive).toEqual([{ name: "Book your hotel room", reason: "checklist_off" }]);
  });

  it("ignores org-audience tasks entirely, active or not", () => {
    const { tasks, inactive } = classifyPersonTasks([
      { name: "Exhibitor", active: true, deadline_at: null,
        tasks: [orgTask("o1", "Place your Stronco order", false), orgTask("o2", "Assign your booth staff")] },
    ]);
    expect(tasks).toEqual([]);
    expect(inactive).toEqual([]);
  });

  it("keeps each checklist's own deadline on its tasks", () => {
    const { tasks } = classifyPersonTasks([
      { name: "A", active: true, deadline_at: "2027-01-08", tasks: [personTask("t1", "One")] },
      { name: "B", active: true, deadline_at: "2026-11-01", tasks: [personTask("t2", "Two")] },
    ]);
    expect(tasks.map((t) => [t.checklistName, t.deadline])).toEqual([
      ["A", "2027-01-08"],
      ["B", "2026-11-01"],
    ]);
  });
});
