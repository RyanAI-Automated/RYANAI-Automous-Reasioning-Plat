import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  validateAttachmentFile,
  safeAttachmentName,
  validateAttachment,
  validateAttachmentBatch,
} from './attachments';

describe('conversation attachment validation', () => {
  it('accepts an allowlisted PDF and normalizes its filename', () => {
    expect(validateAttachment({ name: '../Quarterly report.pdf', type: 'application/pdf', size: 1024 })).toEqual({
      name: 'Quarterly_report.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('rejects executable and unsupported file types', () => {
    expect(() => validateAttachment({ name: 'payload.exe', type: 'application/x-msdownload', size: 12 })).toThrow(/not supported/i);
    expect(() => validateAttachment({ name: 'payload.exe', type: '', size: 12 })).toThrow(/not supported/i);
  });

  it('rejects MIME and extension mismatches', () => {
    expect(() => validateAttachment({ name: 'image.png', type: 'text/html', size: 12 })).toThrow(/not supported/i);
  });

  it('enforces a positive size and the per-file maximum', () => {
    expect(() => validateAttachment({ name: 'empty.pdf', type: 'application/pdf', size: 0 })).toThrow(/between/i);
    expect(() => validateAttachment({ name: 'large.pdf', type: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 })).toThrow(/between/i);
  });

  it('enforces the per-message file count', () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, index) => ({
      name: `file-${index}.pdf`, type: 'application/pdf', size: 100,
    }));
    expect(() => validateAttachmentBatch(files)).toThrow(/no more than/i);
  });

  it('removes path separators and leading dots from display names', () => {
    expect(safeAttachmentName('../../secret.txt')).toBe('secret.txt');
  });
});

it('rejects a batch above the aggregate message size limit', () => {
  const files = Array.from({ length: 3 }, (_, index) => ({
    name: `file-${index}.pdf`, type: 'application/pdf', size: 15 * 1024 * 1024,
  }));
  expect(files.reduce((total, file) => total + file.size, 0)).toBeGreaterThan(MAX_MESSAGE_ATTACHMENT_BYTES);
  expect(() => validateAttachmentBatch(files)).toThrow(/combined attachments/i);
});

it('checks binary signatures before upload', async () => {
  const validPdf = new File(['%PDF-1.7 test'], 'report.pdf', { type: 'application/pdf' });
  await expect(validateAttachmentFile(validPdf)).resolves.toBeUndefined();
  const spoofedPdf = new File(['not a PDF'], 'report.pdf', { type: 'application/pdf' });
  await expect(validateAttachmentFile(spoofedPdf)).rejects.toThrow(/does not match/i);
});
