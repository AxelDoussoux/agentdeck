import { describe, expect, it } from "vitest";
import { SHARED_END, SHARED_START, sharedPart, startShared, withShared } from "./rules";

const file = `${SHARED_START}\nUse pnpm.\n${SHARED_END}\n\n## Claude only\nBe brief.\n`;

describe("sharedPart", () => {
  it("reads the text between the markers", () => {
    expect(sharedPart(file)).toBe("Use pnpm.");
  });

  it("is null without both markers", () => {
    expect(sharedPart("# Rules")).toBeNull();
    expect(sharedPart(`${SHARED_START}\nno end`)).toBeNull();
  });
});

describe("withShared", () => {
  it("replaces the shared base and keeps the rest", () => {
    const updated = withShared(file, "Use pnpm.\nWrite tests.");
    expect(sharedPart(updated)).toBe("Use pnpm.\nWrite tests.");
    expect(updated).toContain("## Claude only\nBe brief.");
  });

  it("adds the base on top of a file without one", () => {
    expect(withShared("Be brief.", "Use pnpm.")).toBe(`${SHARED_START}\nUse pnpm.\n${SHARED_END}\n\nBe brief.`);
  });

  it("writes the base alone in an empty file", () => {
    expect(withShared("  \n", "Use pnpm.")).toBe(`${SHARED_START}\nUse pnpm.\n${SHARED_END}\n`);
  });
});

it("startShared turns a whole file into the base", () => {
  expect(sharedPart(startShared("Use pnpm.\n\n"))).toBe("Use pnpm.");
});
