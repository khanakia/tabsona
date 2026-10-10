// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SiteList } from '../SiteList';
import { ACTION_HELP } from '@/ui/help';

/** No `vi.mock` of any module path: rendered from plain objects, `vi` only for spies. */

afterEach(cleanup);

const allowInput = () => screen.getByLabelText(ACTION_HELP.allowSiteOnly.label);
const allowButton = () => screen.getByText(ACTION_HELP.allowSiteOnly.label, { selector: 'button' });

describe('SiteList — allowing a website without adding it to a persona', () => {
  it('grants a bare host as its https origin, and offers nothing that opens a tab', () => {
    const onAllow = vi.fn();
    render(<SiteList allowedOrigins={[]} onRevoke={() => undefined} onAllow={onAllow} />);
    fireEvent.change(allowInput(), { target: { value: ' auth.example.ai ' } });
    fireEvent.click(allowButton());
    expect(onAllow).toHaveBeenCalledWith('https://auth.example.ai');
    expect(screen.queryByText(ACTION_HELP.addSite.label)).toBeNull();
  });

  it('keeps the scheme and port of a full URL and drops its path', () => {
    const onAllow = vi.fn();
    render(<SiteList allowedOrigins={[]} onRevoke={() => undefined} onAllow={onAllow} />);
    fireEvent.change(allowInput(), { target: { value: 'http://127.0.0.1:8790/idp/authorize?x=1' } });
    fireEvent.click(allowButton());
    expect(onAllow).toHaveBeenCalledWith('http://127.0.0.1:8790');
  });

  it('refuses something that is not a website', () => {
    const onAllow = vi.fn();
    render(<SiteList allowedOrigins={[]} onRevoke={() => undefined} onAllow={onAllow} />);
    fireEvent.change(allowInput(), { target: { value: 'ftp://files.example' } });
    expect(allowButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(allowButton());
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('still lists allowed websites with a way to remove each', () => {
    const onRevoke = vi.fn();
    render(<SiteList allowedOrigins={['https://api.workos.com/*']} onRevoke={onRevoke} onAllow={() => undefined} />);
    fireEvent.click(screen.getByTitle('Stop isolating https://api.workos.com/*'));
    expect(onRevoke).toHaveBeenCalledWith('https://api.workos.com/*');
  });

  it('names the every-website grant in words, first, and removes it by its real pattern', () => {
    const onRevoke = vi.fn();
    render(<SiteList allowedOrigins={['https://api.workos.com/*', '*://*/*']} onRevoke={onRevoke} onAllow={() => undefined} />);
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['All websites', 'api.workos.com']);
    expect(screen.queryByText('*://*')).toBeNull();
    fireEvent.click(screen.getByTitle('Stop isolating all websites'));
    expect(onRevoke).toHaveBeenCalledWith('*://*/*');
  });
});
