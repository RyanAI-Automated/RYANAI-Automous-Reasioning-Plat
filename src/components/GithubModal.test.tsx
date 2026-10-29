import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GithubModal from './GithubModal';

describe('GitHub integration placeholder', () => {
  it('states that OAuth is not configured and disables the connect action', () => {
    const html = renderToStaticMarkup(
      <GithubModal open onClose={vi.fn()} />,
    );

    expect(html).toContain('Not configured');
    expect(html).toContain('GitHub account linking and conversation sync are not configured');
    expect(html).toContain('GitHub OAuth setup required');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('✓ Connected');
  });
});
