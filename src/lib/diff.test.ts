import { describe, expect, it } from "vitest";
import { diffLines, lineCount } from "./diff";

describe("diffLines", () => {
  it("marks added, removed and unchanged lines in order", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("finds nothing to change between equal texts", () => {
    expect(diffLines("x\ny", "x\ny")?.every((line) => line.kind === "same")).toBe(true);
  });

  it("gives up on long texts", () => {
    expect(diffLines("line\n".repeat(2001), "")).toBeNull();
  });
});

describe("lineCount", () => {
  it("counts lines as an editor does", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("one")).toBe(1);
    expect(lineCount("one\n")).toBe(1);
    expect(lineCount("one\ntwo")).toBe(2);
  });
});
