// Pure text helpers for PDFs exported from Logos. No file or process access here,
// so everything in this module can be unit-tested with plain strings.

export interface CleanedExport {
  /** Cleaned text of each page, in export order. */
  pages: string[];
  /** All pages joined with a single space. Offsets below index into this string. */
  fullText: string;
  /** fullText offset where each page begins (pageStarts[i] is where pages[i] starts). */
  pageStarts: number[];
  /** fullText offsets where a printed line begins. Headings usually start a line. */
  lineStarts: Set<number>;
}

export interface PassageHit {
  /** 1-based page number inside the exported PDF. Not the book's printed page. */
  exportPage: number;
  matched: string;
  excerpt: string;
}

const BARE_NUMBER = /^\d{1,4}$/;
const MAX_HEADER_LENGTH = 150;
const LETTER = /\p{L}/u;

// Digits become "#" so a running head like "Expositor's Bible 245" matches
// the same head on the next page ("... 246").
function headerKey(line: string): string {
  return line.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#");
}

// Running heads usually alternate between verso (even) and recto (odd) pages,
// so each group is checked on its own as well as across all pages.
function repeatedHeads(linesPerPage: string[][]): Set<string> {
  const allPages = linesPerPage.map((_, i) => i);
  const groups = [
    allPages,
    allPages.filter((i) => i % 2 === 0),
    allPages.filter((i) => i % 2 === 1),
  ];
  const repeated = new Set<string>();
  for (const group of groups) {
    const pagesWithKey = new Map<string, number>();
    for (const i of group) {
      const keys = new Set(linesPerPage[i].filter((l) => l.length <= MAX_HEADER_LENGTH).map(headerKey));
      for (const key of keys) {
        pagesWithKey.set(key, (pagesWithKey.get(key) ?? 0) + 1);
      }
    }
    // A line is a running head when it appears on at least 3 pages of the group
    // and on at least 60% of them.
    for (const [key, n] of pagesWithKey) {
      if (n >= 3 && n >= 0.6 * group.length) repeated.add(key);
    }
  }
  return repeated;
}

/**
 * Drop bare page numbers and running heads, then join each page's lines. A line
 * that ends in a hyphen is joined to the next line with no space, so "destruc-"
 * and "tion" become "destruc-tion". Other line breaks become spaces.
 */
export function cleanExportPages(rawPages: string[]): CleanedExport {
  const linesPerPage = rawPages.map((raw) =>
    raw
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !BARE_NUMBER.test(line)),
  );
  const repeated = repeatedHeads(linesPerPage);

  const pages: string[] = [];
  const pageStarts: number[] = [];
  const lineStarts = new Set<number>();
  let fullText = "";

  linesPerPage.forEach((rawLines, p) => {
    const lines = rawLines.filter(
      (line) => !(line.length <= MAX_HEADER_LENGTH && repeated.has(headerKey(line))),
    );
    if (p > 0) fullText += " ";
    pageStarts.push(fullText.length);
    let pageText = "";
    lines.forEach((line, i) => {
      const previous = i > 0 ? lines[i - 1] : "";
      const joinsHyphen = i > 0 && /\p{L}-$/u.test(previous);
      if (i > 0 && !joinsHyphen) pageText += " ";
      lineStarts.add(fullText.length + pageText.length);
      pageText += line;
    });
    pages.push(pageText);
    fullText += pageText;
  });

  return { pages, fullText, pageStarts, lineStarts };
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Typographic variants the PDF may use for the characters a user types.
function charPattern(ch: string): string {
  if ("'‘’".includes(ch)) return "['‘’]";
  if ('"“”'.includes(ch)) return '["“”]';
  if ("-–—".includes(ch)) return "[-–—]";
  return escapeRegex(ch);
}

// Between two letters, a hyphen is optional, so "destruction" matches "destruc-tion".
function wordPattern(word: string): string {
  const chars = [...word];
  return chars
    .map((ch, i) => {
      const next = chars[i + 1];
      const optionalHyphen = next !== undefined && LETTER.test(ch) && LETTER.test(next) ? "[-–—]?" : "";
      return charPattern(ch) + optionalHyphen;
    })
    .join("");
}

/**
 * Build a case-insensitive regex for a phrase. Words may be separated by any
 * whitespace (including a line break), quote and dash variants match each
 * other, and a word only matches as a whole word (letters and digits count).
 */
export function phraseToRegex(phrase: string): RegExp {
  const words = phrase.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    throw new Error("Empty phrase");
  }
  const body = words.map(wordPattern).join("\\s+");
  const first = [...words[0]][0];
  const last = [...words[words.length - 1]].at(-1)!;
  const startsWord = /[\p{L}\p{N}]/u.test(first) ? "(?<![\\p{L}\\p{N}])" : "";
  const endsWord = /[\p{L}\p{N}]/u.test(last) ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${startsWord}${body}${endsWord}`, "giu");
}

/** 1-based export page that contains a given offset in fullText. */
export function pageForOffset(pageStarts: number[], offset: number): number {
  let page = 0;
  for (let i = 0; i < pageStarts.length; i++) {
    if (pageStarts[i] <= offset) page = i;
    else break;
  }
  return page + 1;
}

/** Find phrase hits with surrounding context. `total` counts every hit, `hits` keeps the first `maxHits`. */
export function findPhrase(
  clean: CleanedExport,
  phrase: string,
  options: { contextChars?: number; maxHits?: number } = {},
): { total: number; hits: PassageHit[] } {
  const contextChars = options.contextChars ?? 250;
  const maxHits = options.maxHits ?? 5;
  const regex = phraseToRegex(phrase);
  const hits: PassageHit[] = [];
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(clean.fullText)) !== null) {
    total++;
    if (hits.length < maxHits) {
      const start = Math.max(0, match.index - contextChars);
      const end = Math.min(clean.fullText.length, match.index + match[0].length + contextChars);
      hits.push({
        exportPage: pageForOffset(clean.pageStarts, match.index),
        matched: match[0],
        excerpt: clean.fullText.slice(start, end).trim(),
      });
    }
  }
  return { total, hits };
}

export interface SectionText {
  startPage: number;
  endPage: number;
  text: string;
  /** True when more text follows in the export after the returned slice. */
  truncated: boolean;
  /** True when the heading starts a printed line. False means it was found mid-line. */
  atLineStart: boolean;
  /** Other export pages where the same heading text appears (up to 5). */
  otherPages: number[];
}

/**
 * Text from a section heading, up to `maxChars`. When the heading appears more
 * than once, the first occurrence that starts a line is used, since headings
 * usually start lines and cross-references usually do not. Returns null when the
 * heading is not in the export.
 */
export function sectionFrom(clean: CleanedExport, heading: string, maxChars: number): SectionText | null {
  const regex = phraseToRegex(heading);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(clean.fullText)) !== null) {
    matches.push(match);
  }
  if (matches.length === 0) return null;

  const chosen = matches.find((m) => clean.lineStarts.has(m.index)) ?? matches[0];
  const from = chosen.index;
  const to = Math.min(clean.fullText.length, from + maxChars);
  const otherPages = [
    ...new Set(matches.filter((m) => m !== chosen).map((m) => pageForOffset(clean.pageStarts, m.index))),
  ].slice(0, 5);
  return {
    startPage: pageForOffset(clean.pageStarts, from),
    endPage: pageForOffset(clean.pageStarts, Math.max(from, to - 1)),
    text: clean.fullText.slice(from, to).trim(),
    truncated: clean.fullText.slice(to).trim().length > 0,
    atLineStart: clean.lineStarts.has(from),
    otherPages,
  };
}

/** The first `maxChars` of the export, for when no heading or phrase is given. */
export function openingText(clean: CleanedExport, maxChars: number): SectionText {
  const to = Math.min(clean.fullText.length, maxChars);
  return {
    startPage: 1,
    endPage: pageForOffset(clean.pageStarts, Math.max(0, to - 1)),
    text: clean.fullText.slice(0, to).trim(),
    truncated: clean.fullText.slice(to).trim().length > 0,
    atLineStart: true,
    otherPages: [],
  };
}
