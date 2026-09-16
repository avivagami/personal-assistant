/**
 * The assistant's own browser. One task at a time, a fresh browser process
 * per task, closed after the task or after idling. The model never sees
 * pixels: it reads a compact text snapshot with numbered refs and acts on
 * them. Screenshots exist only for the owner's eyes at approval time.
 */
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright";

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
}

export interface Snapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  text: string;
}

const IDLE_MS = 15 * 60_000;
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i;

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private refs = new Map<string, Locator>();
  private idleTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;

  constructor(private readonly executablePath?: string) {}

  get isOpen(): boolean {
    return this.page !== null;
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close("idle"), IDLE_MS);
  }

  private async ensure(): Promise<Page> {
    if (this.page) {
      this.touch();
      return this.page;
    }
    this.browser = await chromium.launch({
      headless: true,
      executablePath: this.executablePath,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
    // Fresh, incognito, nothing saved. Locale and timezone match the owner.
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    this.context.setDefaultTimeout(15_000);
    this.page = await this.context.newPage();
    this.startedAt = Date.now();
    this.touch();
    return this.page;
  }

  async open(url: string): Promise<Snapshot> {
    let u: URL;
    try {
      u = new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      throw new Error("Not a valid web address.");
    }
    if (!/^https?:$/.test(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) {
      throw new Error("That address is not allowed.");
    }
    const page = await this.ensure();
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    return this.snapshot();
  }

  /** Interactive elements with refs, plus visible text. Compact on purpose. */
  async snapshot(maxText = 5000, maxElements = 120): Promise<Snapshot> {
    const page = await this.ensure();
    this.refs.clear();
    const selector =
      'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=option], [role=menuitem], [role=checkbox], [role=radio], [role=combobox], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])';
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 400);
    const elements: SnapshotElement[] = [];
    for (let i = 0; i < count && elements.length < maxElements; i++) {
      const el = locator.nth(i);
      const info = await el
        .evaluate((node) => {
          const e = node as HTMLElement;
          const r = e.getBoundingClientRect();
          const style = window.getComputedStyle(e);
          const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          const tag = e.tagName.toLowerCase();
          const typeAttr = (e as HTMLInputElement).type;
          const role = e.getAttribute("role") || (tag === "input" ? `input:${typeAttr || "text"}` : tag === "a" ? "link" : tag);
          const labelFor = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : null;
          const name = (
            e.getAttribute("aria-label") ||
            labelFor ||
            (e as HTMLInputElement).placeholder ||
            e.getAttribute("title") ||
            e.textContent ||
            e.getAttribute("name") ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
          const value = tag === "input" || tag === "select" || tag === "textarea" ? String((e as HTMLInputElement).value ?? "").slice(0, 60) : undefined;
          return { visible, role, name, value, disabled: (e as HTMLButtonElement).disabled === true };
        })
        .catch(() => null);
      if (!info || !info.visible || info.disabled) continue;
      if (!info.name && !info.value && !info.role.startsWith("input")) continue;
      const ref = `e${elements.length + 1}`;
      this.refs.set(ref, el);
      elements.push({ ref, role: info.role, name: info.name, ...(info.value ? { value: info.value } : {}) });
    }
    const text = await page
      .evaluate(() => (document.body?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim())
      .catch(() => "");
    return { url: page.url(), title: await page.title().catch(() => ""), elements, text: text.slice(0, maxText) };
  }

  private ref(ref: string): Locator {
    const l = this.refs.get(ref);
    if (!l) throw new Error(`Unknown ref ${ref}. Take a new snapshot first.`);
    this.touch();
    return l;
  }

  async click(ref: string): Promise<Snapshot> {
    const el = this.ref(ref);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 10_000 });
    await this.settle();
    return this.snapshot();
  }

  async fill(ref: string, text: string): Promise<Snapshot> {
    const el = this.ref(ref);
    await el.fill(text, { timeout: 10_000 }).catch(async () => {
      await el.click();
      await el.pressSequentially(text);
    });
    return this.snapshot();
  }

  async select(ref: string, value: string): Promise<Snapshot> {
    const el = this.ref(ref);
    await el.selectOption({ label: value }).catch(() => el.selectOption(value));
    await this.settle();
    return this.snapshot();
  }

  async press(key: string): Promise<Snapshot> {
    const page = await this.ensure();
    await page.keyboard.press(key);
    await this.settle();
    return this.snapshot();
  }

  async scroll(direction: "up" | "down"): Promise<Snapshot> {
    const page = await this.ensure();
    await page.mouse.wheel(0, direction === "down" ? 700 : -700);
    await page.waitForTimeout(400);
    return this.snapshot();
  }

  async waitForText(text: string, ms = 10_000): Promise<Snapshot> {
    const page = await this.ensure();
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: ms }).catch(() => {});
    return this.snapshot();
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.ensure();
    return page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
  }

  private async settle(): Promise<void> {
    const page = await this.ensure();
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  }

  async close(reason = "done"): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.refs.clear();
    const b = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    if (b) {
      await b.close().catch(() => {});
      console.log(`[browser] closed (${reason}) after ${Math.round((Date.now() - this.startedAt) / 1000)}s`);
    }
  }
}

let current: BrowserSession | undefined;

/** The one shared session. One task at a time is plenty for one owner. */
export function browserSession(): BrowserSession {
  if (!current) current = new BrowserSession(process.env.CHROMIUM_PATH || undefined);
  return current;
}

export function formatSnapshot(s: Snapshot): string {
  const els = s.elements.map((e) => `${e.ref} ${e.role} "${e.name}"${e.value ? ` value="${e.value}"` : ""}`).join("\n");
  return `URL: ${s.url}\nTitle: ${s.title}\n\nInteractive elements:\n${els || "(none)"}\n\nPage text:\n${s.text}`;
}
