import { describe, expect, it, afterAll } from "vitest";
import { browserSession } from "../src/browser/session.js";
import { runTool } from "../src/agent/tools.js";
import type { ToolBackend } from "../src/agent/backend.js";

const backend = {} as ToolBackend;
const shots: string[] = [];
const ctx = { backend, onProposal: async () => {}, onScreenshot: async (_: Buffer, c: string) => { shots.push(c); } };

afterAll(async () => { await browserSession().close(); });

describe("browser tools and the submit gate", () => {
  it("refuses to click a final-action button directly, and takes screenshots", async () => {
    const session = browserSession();
    const page = await (session as unknown as { ensure: () => Promise<import("playwright").Page> }).ensure();
    await page.setContent('<input placeholder="Name"><button>Reserve now</button><button>Next</button>');
    const snap = await session.snapshot();
    const reserve = snap.elements.find((e) => e.name === "Reserve now")!;
    const next = snap.elements.find((e) => e.name === "Next")!;
    const refused = await runTool("browser_act", { action: "click", ref: reserve.ref }, ctx);
    expect(refused).toMatch(/Refused/);
    expect(refused).toContain("browser_submit");
    const ok = await runTool("browser_act", { action: "click", ref: next.ref }, ctx);
    expect(ok).toContain("UNTRUSTED_CONTENT");
    const shot = await runTool("browser_screenshot", { caption: "About to book" }, ctx);
    expect(shot).toMatch(/sent/);
    expect(shots).toEqual(["About to book"]);
  }, 60_000);
});
