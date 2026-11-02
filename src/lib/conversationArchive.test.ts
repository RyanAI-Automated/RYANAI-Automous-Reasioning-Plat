import { describe, expect, it } from 'vitest';
import { createTarArchive, readTarArchive } from './conversationArchive';

describe('conversation TAR archives', () => {
  it('round-trips a manifest, transcript, and binary attachment', async () => {
    const entries = [
      { path: 'manifest.json', data: new TextEncoder().encode('{"version":1}') },
      { path: 'conversation.md', data: new TextEncoder().encode('# RyanAI') },
      { path: 'attachments/message-1-report.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0xff]) },
    ];
    const archive = createTarArchive(entries);
    const restored = await readTarArchive(archive);
    expect(restored.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    expect(restored.map((entry) => Array.from(entry.data))).toEqual(entries.map((entry) => Array.from(entry.data)));
  });

  it('rejects traversal paths and duplicate names while creating archives', () => {
    expect(() => createTarArchive([{ path: '../secrets.txt', data: new Uint8Array([1]) }])).toThrow(/unsafe path/i);
    expect(() => createTarArchive([
      { path: 'manifest.json', data: new Uint8Array([1]) },
      { path: 'manifest.json', data: new Uint8Array([2]) },
    ])).toThrow(/duplicate/i);
  });

  it('rejects a modified TAR header checksum', async () => {
    const archive = createTarArchive([{ path: 'manifest.json', data: new Uint8Array([1]) }]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    bytes[0] ^= 1;
    await expect(readTarArchive(new Blob([bytes.buffer]))).rejects.toThrow(/checksum/i);
  });

  it('rejects archives containing symbolic links', async () => {
    const archive = createTarArchive([{ path: 'manifest.json', data: new Uint8Array([1]) }]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    bytes[156] = 0x32;
    const checksumHeader = bytes.slice(0, 512);
    checksumHeader.fill(0x20, 148, 156);
    const checksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    const encoded = checksum.toString(8).padStart(6, '0');
    bytes.set(new TextEncoder().encode(encoded), 148);
    bytes[154] = 0;
    bytes[155] = 0x20;
    await expect(readTarArchive(new Blob([bytes.buffer]))).rejects.toThrow(/regular files only/i);
  });
});
