import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  validateAttachmentFile,
  safeAttachmentName,
  validateAttachment,
  validateAttachmentBatch,
  uploadConversationAttachments,
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


describe('attachment upload progress and cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  class MockXMLHttpRequest {
    static instances: MockXMLHttpRequest[] = [];
    static autoComplete = true;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn(() => {
      if (MockXMLHttpRequest.autoComplete) {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 900, total: 1000 } as ProgressEvent);
        this.onload?.();
      }
    });
    abort = vi.fn(() => this.onabort?.());
    constructor() {
      MockXMLHttpRequest.instances.push(this);
    }
  }

  function createStorageClient() {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.test/upload?token=temporary' },
      error: null,
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      storage: {
        from: vi.fn(() => ({ createSignedUploadUrl, remove })),
      },
    } as unknown as SupabaseClient;
    return { client, createSignedUploadUrl, remove };
  }

  it('reports byte progress and returns metadata after a signed upload succeeds', async () => {
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.autoComplete = true;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

    const { client, createSignedUploadUrl } = createStorageClient();
    const file = new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' });
    const onProgress = vi.fn();
    const result = await uploadConversationAttachments(client, 'user-1', 'conversation-1', 'message-1', [file], { onProgress });

    expect(createSignedUploadUrl).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'report.pdf', mimeType: 'application/pdf', size: file.size });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ loaded: file.size, total: file.size }));
  });

  it('aborts an active request and removes the reserved private object path', async () => {
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.autoComplete = false;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    const { client, remove } = createStorageClient();
    const controller = new AbortController();
    const file = new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' });
    const pending = uploadConversationAttachments(
      client,
      'user-1',
      'conversation-1',
      'message-1',
      [file],
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(MockXMLHttpRequest.instances).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(remove).toHaveBeenCalledWith([expect.stringContaining('/report.pdf')]);
  });
});
