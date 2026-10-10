import { describe, it, expect } from "vitest";
import {
  cleanExportPages,
  phraseToRegex,
  findPhrase,
  sectionFrom,
  openingText,
  pageForOffset,
} from "../src/utils/pdf-text.js";

const RAW = [
  "Expositor's Bible Vol. 5\nThe Defeat of Pride\nPride goes before destruction.\n1",
  "Expositor's Bible Vol. 5\nThe apostles were humble.\n2",
  "Expositor's Bible Vol. 5\nGrace follows the broken heart.\n3",
];

describe("cleanExportPages", () => {
  it("drops bare page numbers and running heads that repeat on most pages", () => {
    const clean = cleanExportPages(RAW);
    expect(clean.pages).toEqual([
      "The Defeat of Pride Pride goes before destruction.",
      "The apostles were humble.",
      "Grace follows the broken heart.",
    ]);
  });

  it("drops running heads whose page numbers change from page to page", () => {
    const clean = cleanExportPages([
      "Expositor's Bible 245\nFirst body line.",
      "Expositor's Bible 246\nSecond body line.",
      "Expositor's Bible 247\nThird body line.",
    ]);
    expect(clean.pages.join(" ")).not.toMatch(/Expositor/);
    expect(clean.pages[1]).toBe("Second body line.");
  });

  it("keeps a line that appears on only one page", () => {
    const clean = cleanExportPages(["Only here\nBody.", "Body two.", "Body three."]);
    expect(clean.pages[0]).toBe("Only here Body.");
  });

  it("records where each page starts inside fullText", () => {
    const clean = cleanExportPages(RAW);
    expect(clean.fullText.slice(clean.pageStarts[1]).startsWith("The apostles")).toBe(true);
    expect(clean.fullText.slice(clean.pageStarts[2]).startsWith("Grace")).toBe(true);
  });
});

describe("phraseToRegex", () => {
  it("matches words split across a line break", () => {
    const re = phraseToRegex("Pride goes before");
    expect("Pride goes\nbefore destruction".match(re)?.[0]).toBe("Pride goes\nbefore");
  });

  it("treats curly and straight apostrophes as the same", () => {
    const re = phraseToRegex("God's grace");
    expect(re.test("God’s grace")).toBe(true);
    re.lastIndex = 0;
    expect(re.test("God's grace")).toBe(true);
  });

  it("does not match inside a longer word", () => {
    const re = phraseToRegex("God");
    expect("godly and God".match(re)).toEqual(["God"]);
  });

  it("is case-insensitive", () => {
    expect("THE DEFEAT".match(phraseToRegex("the defeat"))).not.toBeNull();
  });

  it("escapes punctuation in the phrase", () => {
    expect("see (1) below".match(phraseToRegex("(1)"))).toEqual(["(1)"]);
  });

  it("rejects an empty phrase", () => {
    expect(() => phraseToRegex("   ")).toThrow();
  });
});

describe("findPhrase", () => {
  const clean = cleanExportPages(RAW);

  it("reports the export page where the phrase starts", () => {
    const { total, hits } = findPhrase(clean, "grace");
    expect(total).toBe(1);
    expect(hits[0].exportPage).toBe(3);
    expect(hits[0].matched).toBe("Grace");
  });

  it("counts every match even when only some are returned", () => {
    const text = cleanExportPages(["a grace b grace c", "grace"]);
    const { total, hits } = findPhrase(text, "grace", { maxHits: 2 });
    expect(total).toBe(3);
    expect(hits).toHaveLength(2);
  });

  it("returns surrounding context in the excerpt", () => {
    const { hits } = findPhrase(clean, "humble", { contextChars: 10 });
    expect(hits[0].excerpt).toContain("humble");
    expect(hits[0].excerpt.length).toBeLessThan(clean.fullText.length);
  });

  it("returns no hits when the phrase is absent", () => {
    expect(findPhrase(clean, "nonexistent phrase")).toEqual({ total: 0, hits: [] });
  });
});

describe("sectionFrom", () => {
  const clean = cleanExportPages(RAW);

  it("starts at the heading and reports its export pages", () => {
    const section = sectionFrom(clean, "The Defeat of Pride", 1000);
    expect(section).not.toBeNull();
    expect(section!.startPage).toBe(1);
    expect(section!.text.startsWith("The Defeat of Pride")).toBe(true);
    expect(section!.truncated).toBe(false);
  });

  it("cuts at maxChars and says more text follows", () => {
    const section = sectionFrom(clean, "The Defeat of Pride", 25);
    expect(section!.text.length).toBeLessThanOrEqual(25);
    expect(section!.text.startsWith("The Defeat of Pride")).toBe(true);
    expect(section!.truncated).toBe(true);
  });

  it("returns null when the heading is missing", () => {
    expect(sectionFrom(clean, "Not a heading", 1000)).toBeNull();
  });
});

describe("openingText", () => {
  it("returns the start of the export and reports truncation", () => {
    const clean = cleanExportPages(RAW);
    const opening = openingText(clean, 15);
    expect(opening.startPage).toBe(1);
    expect(opening.text).toHaveLength(15);
    expect(opening.truncated).toBe(true);
  });
});

describe("pageForOffset", () => {
  it("maps offsets to 1-based pages", () => {
    expect(pageForOffset([0, 10, 25], 0)).toBe(1);
    expect(pageForOffset([0, 10, 25], 9)).toBe(1);
    expect(pageForOffset([0, 10, 25], 10)).toBe(2);
    expect(pageForOffset([0, 10, 25], 30)).toBe(3);
  });
});
