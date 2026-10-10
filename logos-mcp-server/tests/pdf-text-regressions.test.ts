import { describe, it, expect } from "vitest";
import { cleanExportPages, phraseToRegex, findPhrase, sectionFrom, openingText } from "../src/utils/pdf-text.js";

describe("running heads that alternate between page sides", () => {
  it("removes a verso head and a recto head that each appear on every other page", () => {
    const raw = [
      "Expositor's Bible 200\nPride goes before\n1",
      "The Defeat of Pride 201\ndestruction and a haughty spirit.\n2",
      "Expositor's Bible 202\nThe apostles were humble.\n3",
      "The Defeat of Pride 203\nGrace follows.\n4",
      "Expositor's Bible 204\nMore text.\n5",
      "The Defeat of Pride 205\nEven more.\n6",
    ];
    const clean = cleanExportPages(raw);
    expect(clean.fullText).not.toMatch(/Expositor's Bible/);
    expect(clean.fullText).not.toMatch(/The Defeat of Pride \d/);
    expect(findPhrase(clean, "pride goes before destruction").total).toBe(1);
  });
});

describe("word boundaries outside ASCII", () => {
  it("does not match a verse number inside a longer one", () => {
    const clean = cleanExportPages(["See Romans 10:3 and Romans 1:17."]);
    const { total, hits } = findPhrase(clean, "Romans 1");
    expect(total).toBe(1);
    expect(hits[0].excerpt).toContain("Romans 1:17");
  });

  it("does not match a number inside a longer number", () => {
    const clean = cleanExportPages(["Paid 14 dollars and 4 more"]);
    expect(findPhrase(clean, "4").total).toBe(1);
  });

  it("does not match a prefix of an accented word", () => {
    const clean = cleanExportPages(["un café noir"]);
    expect(findPhrase(clean, "caf").total).toBe(0);
    expect(findPhrase(clean, "café").total).toBe(1);
  });

  it("does not match a prefix of a Greek word", () => {
    const clean = cleanExportPages(["ἐν Ἰησοῦς ἐστιν"]);
    expect(findPhrase(clean, "Ἰησοῦ").total).toBe(0);
  });

  it("keeps the phrase regex case-insensitive with the unicode flag", () => {
    expect(phraseToRegex("Café").flags).toContain("u");
    expect("CAFÉ".match(phraseToRegex("café"))).not.toBeNull();
  });
});

describe("hyphenated line breaks", () => {
  it("joins a word broken at a line end and keeps the hyphen", () => {
    const clean = cleanExportPages(["The destruc-\ntion of the proud is sure.", "More text."]);
    expect(clean.fullText).toContain("destruc-tion");
  });

  it("finds the whole word across a hyphenated break", () => {
    const clean = cleanExportPages(["The destruc-\ntion of the proud is sure.", "More text."]);
    expect(findPhrase(clean, "destruction").total).toBe(1);
    expect(findPhrase(clean, "destruc-tion").total).toBe(1);
  });

  it("keeps a real compound hyphen at a line end", () => {
    const clean = cleanExportPages(["Self-\ncontrol is a fruit.", "Next."]);
    expect(clean.fullText).toContain("Self-control");
  });
});

describe("section headings", () => {
  it("prefers the heading that starts a line over a mid-line mention", () => {
    const clean = cleanExportPages([
      "Contents: see The Defeat of Pride on this page.",
      "The Defeat of Pride\nBody text here.",
    ]);
    const section = sectionFrom(clean, "The Defeat of Pride", 200);
    expect(section?.startPage).toBe(2);
    expect(section?.atLineStart).toBe(true);
    expect(section?.otherPages).toEqual([1]);
  });

  it("reports a mid-line heading when no line starts with it", () => {
    const clean = cleanExportPages(["Nothing here but see The Defeat of Pride in the text."]);
    const section = sectionFrom(clean, "The Defeat of Pride", 200);
    expect(section?.atLineStart).toBe(false);
    expect(section?.otherPages).toEqual([]);
  });
});

describe("truncation", () => {
  it("does not report truncation when only whitespace is left", () => {
    const clean = cleanExportPages(["Alpha", ""]);
    expect(clean.fullText).toBe("Alpha ");
    expect(openingText(clean, 5).truncated).toBe(false);
    expect(sectionFrom(clean, "Alpha", 5)?.truncated).toBe(false);
  });

  it("reports truncation when real text follows", () => {
    const clean = cleanExportPages(["Alpha beta gamma"]);
    expect(openingText(clean, 5).truncated).toBe(true);
  });
});
