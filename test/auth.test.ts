import { describe, expect, it } from "vitest";
import { extractCode } from "../src/google/auth.js";

describe("extractCode", () => {
  it("pulls the code out of a pasted redirect URL", () => {
    expect(extractCode("http://localhost:8765/oauth/callback?code=4/0AbCdEf-ghijklmnop_qrstuvwxyz1234567890&scope=email")).toBe("4/0AbCdEf-ghijklmnop_qrstuvwxyz1234567890");
  });
  it("accepts a bare code", () => {
    expect(extractCode("4/0AbCdEf-ghijklmnop_qrstuvwxyz1234567890")).toBe("4/0AbCdEf-ghijklmnop_qrstuvwxyz1234567890");
  });
  it("rejects chatter", () => {
    expect(extractCode("hello there")).toBeNull();
  });
});
