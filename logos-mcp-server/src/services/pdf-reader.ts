// Reads PDFs that the user exported from Logos (Print/Export → PDF). Uses Apple's
// built-in PDFKit through a tiny helper compiled with clang, the same way the
// screenshot helpers are built. Reads only the file it is given.

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { extname, isAbsolute } from "path";
import { HELPER_CACHE_DIR, PDF_HELPER_BIN, PDF_HELPER_SRC } from "../config.js";

const execFileAsync = promisify(execFile);

export const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const READ_TIMEOUT_MS = 120_000;

// Prints {"pageCount": N, "pages": [text per page]} as JSON on stdout.
const PDF_HELPER_SOURCE = String.raw`#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "usage: logos-pdf-helper <file.pdf>\n");
      return 2;
    }
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    PDFDocument *doc = [[PDFDocument alloc] initWithURL:url];
    if (doc == nil) {
      fprintf(stderr, "could not open the PDF\n");
      return 1;
    }
    if (doc.isLocked) {
      fprintf(stderr, "the PDF is password-protected\n");
      return 1;
    }
    NSMutableArray *pages = [NSMutableArray arrayWithCapacity:doc.pageCount];
    for (NSUInteger i = 0; i < doc.pageCount; i++) {
      NSString *text = [doc pageAtIndex:i].string;
      [pages addObject:(text != nil ? text : @"")];
    }
    NSDictionary *out = @{ @"pageCount": @(doc.pageCount), @"pages": pages };
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:NULL];
    if (json == nil) {
      fprintf(stderr, "could not encode the PDF text\n");
      return 1;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    return 0;
  }
}
`;

// One build at a time per server process; later calls wait for the same build.
let helperReady: Promise<void> | undefined;

function ensurePdfHelper(): Promise<void> {
  helperReady ??= buildPdfHelperIfNeeded().catch((e) => {
    helperReady = undefined;
    throw e;
  });
  return helperReady;
}

async function buildPdfHelperIfNeeded(): Promise<void> {
  // Private per-user cache dir, same as the other helpers (see config.ts).
  mkdirSync(HELPER_CACHE_DIR, { recursive: true, mode: 0o700 });
  const sourceMatches = existsSync(PDF_HELPER_SRC) && readFileSync(PDF_HELPER_SRC, "utf-8") === PDF_HELPER_SOURCE;
  if (sourceMatches && existsSync(PDF_HELPER_BIN)) return;

  // Compile under temporary names and move both files into place only after
  // success, so a failed build never leaves new source next to an old binary.
  const tmpSrc = `${PDF_HELPER_SRC}.${process.pid}.tmp`;
  const tmpBin = `${PDF_HELPER_BIN}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpSrc, PDF_HELPER_SOURCE);
    await execFileAsync("clang", [
      "-fobjc-arc",
      "-framework", "Foundation",
      "-framework", "PDFKit",
      "-o", tmpBin,
      tmpSrc,
    ]);
    renameSync(tmpBin, PDF_HELPER_BIN);
    renameSync(tmpSrc, PDF_HELPER_SRC);
  } catch {
    throw new Error("Could not build the PDF reader. It needs Apple's developer tools: run `xcode-select --install` in Terminal, then try again.");
  } finally {
    rmSync(tmpSrc, { force: true });
    rmSync(tmpBin, { force: true });
  }
}

export interface RawExport {
  pageCount: number;
  pages: string[];
}

/** Validate the path, then return the text of every page. Throws with a readable message. */
export async function readExportedPdf(path: string): Promise<RawExport> {
  if (process.platform !== "darwin") {
    throw new Error("Reading exported PDFs needs macOS (it uses Apple's PDFKit).");
  }
  if (!isAbsolute(path)) {
    throw new Error("Give the full path to the PDF, starting with /");
  }
  if (extname(path).toLowerCase() !== ".pdf") {
    throw new Error("The file must be a .pdf (export from Logos with Print/Export → PDF)");
  }
  if (!existsSync(path)) {
    throw new Error(`No file at ${path}`);
  }
  const size = statSync(path).size;
  if (size > MAX_EXPORT_BYTES) {
    throw new Error(`The PDF is ${Math.round(size / 1048576)} MB; the limit is ${MAX_EXPORT_BYTES / 1048576} MB`);
  }

  await ensurePdfHelper();
  try {
    const { stdout } = await execFileAsync(PDF_HELPER_BIN, [path], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: READ_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as RawExport;
    return { pageCount: parsed.pageCount, pages: parsed.pages };
  } catch (e) {
    const failure = e as { killed?: boolean; stderr?: string };
    if (failure.killed) {
      throw new Error("Reading the PDF took longer than 2 minutes and was stopped. Try a smaller export.");
    }
    const stderr = failure.stderr?.trim();
    throw new Error(stderr || (e instanceof Error ? e.message.split("\n")[0] : String(e)));
  }
}
