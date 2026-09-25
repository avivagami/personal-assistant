import { describe, expect, it } from "vitest";
import { BUCKETS, triageInstructions } from "../src/proactive/triage.js";

describe("triage instructions", () => {
  it("names every bucket with what it catches and what to report", () => {
    const text = triageInstructions(true);
    for (const b of BUCKETS) {
      expect(text).toContain(`- ${b.name}:`);
      expect(text).toContain(b.action);
    }
  });

  it("puts each message in exactly one bucket and reads snippets before bodies", () => {
    const text = triageInstructions(true);
    expect(text).toContain("exactly one");
    expect(text).toMatch(/snippet/i);
    expect(text.indexOf("gmail_search")).toBeLessThan(text.indexOf("gmail_read"));
  });

  it("drafts only for urgent, and only when enabled", () => {
    expect(triageInstructions(true)).toMatch(/urgent bucket only.*three/s);
    expect(triageInstructions(false)).toContain("Do not draft anything");
  });

  it("checks the calendar before proposing an event", () => {
    expect(triageInstructions(true)).toMatch(/check the calendar first/i);
  });
});
