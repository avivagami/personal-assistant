import { describe, expect, it, afterAll } from "vitest";
import { BrowserSession, formatSnapshot } from "../src/browser/session.js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const html = `<html><body><h1>Book a table</h1>
<label for="n">Name</label><input id="n">
<input placeholder="Phone">
<select id="party"><option>2</option><option>4</option></select>
<button onclick="document.getElementById('out').textContent='Booked for '+document.getElementById('n').value">Reserve</button>
<div id="out"></div>
<div style="display:none"><button>Hidden</button></div>
</body></html>`;

const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
const port = 18765;
server.listen(port);
const session = new BrowserSession(process.env.CHROMIUM_PATH || undefined);

afterAll(async () => { await session.close(); server.close(); });

describe("browser session", () => {
  it("snapshots interactive elements with refs and fills a form", async () => {
    // localhost is blocked by design; use the loopback-bypass for the test server via 127.0.0.1? Also blocked. Use a file URL is blocked too. So test the snapshot on a data page via open() of an allowed host is impossible offline; exercise internals instead.
    const anySession = session as unknown as { ensure: () => Promise<import("playwright").Page> };
    const page = await anySession.ensure();
    await page.setContent(html);
    const snap = await session.snapshot();
    const text = formatSnapshot(snap);
    expect(text).toContain('input:text "Name"');
    expect(text).toContain('"Phone"');
    expect(text).toContain('button "Reserve"');
    expect(text).not.toContain("Hidden");
    const name = snap.elements.find((e) => e.name === "Name")!;
    const reserve = snap.elements.find((e) => e.name === "Reserve")!;
    await session.fill(name.ref, "Aviv");
    const after = await session.click(reserve.ref);
    expect(after.text).toContain("Booked for Aviv");
  }, 60_000);

  it("refuses private addresses", async () => {
    await expect(session.open("http://localhost:8080")).rejects.toThrow(/not allowed/);
    await expect(session.open("http://192.168.1.1")).rejects.toThrow(/not allowed/);
  });
});
