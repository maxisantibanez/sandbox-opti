import { describe, expect, it } from "vitest";

import {
  formatEditableNumber,
  parseEditableNumber,
} from "./number-input";

describe("parseEditableNumber", () => {
  it.each([
    ["40", 40],
    [" 40 ", 40],
    ["-2.5", -2.5],
    ["-2,5", -2.5],
    ["2.", 2],
    [",5", 0.5],
    ["1e3", 1000],
  ])("parses %s", (text, expected) => {
    expect(parseEditableNumber(text)).toBe(expected);
  });

  it.each(["", "-", ".", ",", "abc", "1,2,3", "Infinity"])(
    "keeps %s as an incomplete draft",
    (text) => {
      expect(parseEditableNumber(text)).toBeNull();
    },
  );
});

describe("formatEditableNumber", () => {
  it("uses a comma decimal separator without grouping", () => {
    expect(formatEditableNumber(2.5)).toBe("2,5");
    expect(formatEditableNumber(1000)).toBe("1000");
  });

  it("normalizes negative zero", () => {
    expect(formatEditableNumber(-0)).toBe("0");
  });
});
