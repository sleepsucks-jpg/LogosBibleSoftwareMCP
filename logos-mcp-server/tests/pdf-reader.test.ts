import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { readExportedPdf } from "../src/services/pdf-reader.js";
import { cleanExportPages, sectionFrom, findPhrase } from "../src/utils/pdf-text.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/logos-style-export.pdf", import.meta.url));
const isMac = process.platform === "darwin";

describe("readExportedPdf input checks", () => {
  it("rejects a relative path", async () => {
    await expect(readExportedPdf("export.pdf")).rejects.toThrow(/full path/);
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(readExportedPdf("/etc/hosts")).rejects.toThrow(/must be a \.pdf/);
  });

  it("rejects a PDF path that does not exist", async () => {
    await expect(readExportedPdf("/nonexistent/folder/missing.pdf")).rejects.toThrow(/No file at/);
  });
});

describe.skipIf(!isMac)("readExportedPdf on a Logos-style export (macOS)", () => {
  it("returns every page with its text", async () => {
    const raw = await readExportedPdf(FIXTURE);
    expect(raw.pageCount).toBe(3);
    expect(raw.pages).toHaveLength(3);
    expect(raw.pages[1]).toContain("apostles were not puffed up");
  });

  it("removes the repeated running head and page numbers from the cleaned text", async () => {
    const clean = cleanExportPages((await readExportedPdf(FIXTURE)).pages);
    expect(clean.fullText).not.toMatch(/Expositor's Bible/);
    expect(clean.pages[0]).not.toMatch(/^1$/);
  });

  it("finds a section by heading and a phrase by its export page", async () => {
    const clean = cleanExportPages((await readExportedPdf(FIXTURE)).pages);
    const section = sectionFrom(clean, "The Defeat of Pride", 400);
    expect(section?.startPage).toBe(1);
    expect(section?.text).toContain("haughty spirit before a fall");

    const hit = findPhrase(clean, "puffed up by their own strength");
    expect(hit.total).toBe(1);
    expect(hit.hits[0].exportPage).toBe(2);
  });
});
