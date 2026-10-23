// File path: ./src/types/ambient.d.ts

/**
 * Ambient module declarations for untyped third-party libraries (resolves TS2307).
 */

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export = pdfParse;
}

declare module 'pdf-parse' {
  export { default } from 'pdf-parse/lib/pdf-parse.js';
}