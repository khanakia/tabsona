// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutLinks } from '../AboutLinks';
import { PROJECT_LINKS } from '@/core/constants';

/** No module mocks: the links render from the PROJECT_LINKS constant alone. */
describe('AboutLinks', () => {
  it('points to khanakia.com, the help pages and the issue tracker', () => {
    render(<AboutLinks />);
    expect(screen.getByText('khanakia.com').getAttribute('href')).toBe(PROJECT_LINKS.website);
    expect(screen.getByText('Help & how it works').getAttribute('href')).toBe(PROJECT_LINKS.docs);
    expect(screen.getByText('Report a problem').getAttribute('href')).toBe(PROJECT_LINKS.issues);
    expect(screen.getByText('More tools').getAttribute('href')).toBe(PROJECT_LINKS.apps);
  });

  it('opens every link in a new tab without handing over this page', () => {
    render(<AboutLinks />);
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('keeps only the essentials in the compact form under the popup guide', () => {
    render(<AboutLinks compact />);
    expect(screen.queryByText('GitHub')).toBeNull();
    expect(screen.getByText('khanakia.com')).toBeTruthy();
  });
});
