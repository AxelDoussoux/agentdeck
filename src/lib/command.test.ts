import { describe, expect, it } from "vitest";
import { joinCommand, splitCommand } from "./command";

describe("splitCommand", () => {
  it("splits on spaces and keeps quoted words whole", () => {
    expect(splitCommand(`npx -y "@scope/server name" 'it''s'`)).toEqual(["npx", "-y", "@scope/server name", "its"]);
  });

  it("keeps empty quoted words", () => {
    expect(splitCommand(`run "" ''`)).toEqual(["run", "", ""]);
  });

  it("reads escapes outside single quotes only", () => {
    expect(splitCommand(String.raw`a\ b "c\"d" 'e\f'`)).toEqual(["a b", 'c"d', String.raw`e\f`]);
  });

  it("leaves Windows paths alone", () => {
    expect(splitCommand(String.raw`C:\tools\server.exe --dir C:\data`)).toEqual([
      String.raw`C:\tools\server.exe`,
      "--dir",
      String.raw`C:\data`,
    ]);
  });
});

describe("joinCommand", () => {
  const cases = [
    ["node", "server.js"],
    ["npx", "-y", "@scope/server name"],
    ["echo", 'say "hi"', "it's"],
    [String.raw`C:\Program Files\server.exe`, "C:\\data\\"],
    ["run", ""],
    [String.raw`a\ b`],
  ];

  it.each(cases)("reads back the same words: %j", (...words) => {
    expect(splitCommand(joinCommand(words))).toEqual(words);
  });

  it("quotes only the words that need it", () => {
    expect(joinCommand(["npx", "-y", "my server"])).toBe('npx -y "my server"');
  });
});
