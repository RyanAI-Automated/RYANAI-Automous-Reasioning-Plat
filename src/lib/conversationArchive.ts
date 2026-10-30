const BLOCK_SIZE = 512;
const END_BLOCKS = 2;
export const MAX_CONVERSATION_ARCHIVE_BYTES = 250 * 1024 * 1024;

export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encodeText(value);
  if (bytes.length > length) throw new Error(`Archive path or field is too long: ${value}`);
  target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length > length - 1) throw new Error('Archive entry exceeds the supported TAR size.');
  writeString(target, offset, length - 1, encoded);
  target[offset + length - 1] = 0;
}

function readString(source: Uint8Array, offset: number, length: number): string {
  const end = source.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return new TextDecoder().decode(source.subarray(offset, stop));
}

function readOctal(source: Uint8Array, offset: number, length: number): number {
  const value = readString(source, offset, length).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid TAR numeric field.');
  return Number.parseInt(value, 8);
}

function validateArchivePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error('Archive contains an unsafe path.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Archive contains an unsafe path.');
  }
}

function writeHeader(path: string, size: number): Uint8Array {
  validateArchivePath(path);
  const bytes = encodeText(path);
  if (bytes.length > 100) throw new Error(`Archive path is too long: ${path}`);
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, 100, path);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export function createTarArchive(entries: readonly ArchiveEntry[]): Blob {
  const seen = new Set<string>();
  const chunks: Uint8Array[] = [];
  let archiveBytes = BLOCK_SIZE * END_BLOCKS;
  for (const entry of entries) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}`);
    seen.add(entry.path);
    const data = entry.data;
    archiveBytes += BLOCK_SIZE + Math.ceil(data.byteLength / BLOCK_SIZE) * BLOCK_SIZE;
    if (archiveBytes > MAX_CONVERSATION_ARCHIVE_BYTES) {
      throw new Error('Conversation archive exceeds the 250 MB export safety limit.');
    }
    chunks.push(writeHeader(entry.path, data.byteLength));
    chunks.push(data);
    const padding = (BLOCK_SIZE - (data.byteLength % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(BLOCK_SIZE * END_BLOCKS));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([archive.buffer], { type: 'application/x-tar' });
}

/** Parse only regular files from a TAR archive; reject links, traversal, duplicates and bad checksums. */
export async function readTarArchive(blob: Blob): Promise<ArchiveEntry[]> {
  if (blob.size > MAX_CONVERSATION_ARCHIVE_BYTES) {
    throw new Error('Conversation archive exceeds the 250 MB import safety limit.');
  }
  const source = new Uint8Array(await blob.arrayBuffer());
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (offset + BLOCK_SIZE <= source.length) {
    const header = source.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = readOctal(header, 148, 8);
    const checksumHeader = header.slice();
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (actualChecksum !== expectedChecksum) throw new Error('TAR header checksum validation failed.');
    const path = readString(header, 0, 100);
    validateArchivePath(path);
    if (seen.has(path)) throw new Error(`Duplicate archive path: ${path}`);
    seen.add(path);
    const type = header[156];
    if (type !== 0 && type !== 0x30) throw new Error('TAR archives may contain regular files only.');
    const size = readOctal(header, 124, 12);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > source.length) {
      throw new Error('TAR entry has an invalid size or truncated content.');
    }
    entries.push({ path, data: source.slice(dataStart, dataEnd) });
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  if (!entries.length) throw new Error('The archive contains no files.');
  return entries;
}
