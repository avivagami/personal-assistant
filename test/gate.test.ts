import { describe, expect, it } from "vitest";
import { ActionSchemas, describeAction } from "../src/actions/gate.js";

describe("approval gate schemas", () => {
  it("rejects a send_email without a body", () => {
    const r = ActionSchemas.send_email.safeParse({ to: "x@y.z", subject: "s" });
    expect(r.success).toBe(false);
  });
  it("accepts a well formed create_event", () => {
    const r = ActionSchemas.create_event.safeParse({ title: "Lunch", startIso: "2026-09-18T13:00:00+03:00", endIso: "2026-09-18T14:00:00+03:00" });
    expect(r.success).toBe(true);
  });
  it("describes a send_email for the approval button", () => {
    const s = describeAction("send_email", { to: "dana@example.com", subject: "Lunch?", body: "Thursday?" });
    expect(s).toContain("dana@example.com");
    expect(s).toContain("Lunch?");
  });
});
