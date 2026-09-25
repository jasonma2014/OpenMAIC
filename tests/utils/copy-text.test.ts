import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyPlainText } from '@/lib/utils/copy-text';

function field(): HTMLInputElement {
  return {
    focus: vi.fn(),
    select: vi.fn(),
  } as unknown as HTMLInputElement;
}

describe('copyPlainText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies through the clipboard API', async () => {
    const input = field();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal('document', { execCommand: vi.fn().mockReturnValue(false) });

    await expect(copyPlainText('D7Y68QT4', input)).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('D7Y68QT4');
  });

  it('keeps the synchronous selection copy when the clipboard API rejects', async () => {
    const input = field();
    const order: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => {
          order.push('clipboard');
          return Promise.reject(new Error('NotAllowedError: Document is not focused.'));
        }),
      },
    });
    vi.stubGlobal('document', {
      execCommand: vi.fn().mockImplementation(() => {
        order.push('command');
        return true;
      }),
    });

    const pending = copyPlainText('D7Y68QT4', input);
    expect(order).toEqual(['command', 'clipboard']);
    await expect(pending).resolves.toBe(true);
    expect(input.select).toHaveBeenCalledOnce();
  });
});
