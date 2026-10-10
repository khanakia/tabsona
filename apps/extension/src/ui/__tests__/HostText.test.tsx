// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HostText, splitHostTail } from '../HostText';

describe('splitHostTail', () => {
  it('keeps the registrable domain as the tail and the leading labels as the head', () => {
    expect(splitHostTail('staging-app.franchisepartner.com')).toEqual({ head: 'staging-app.', tail: 'franchisepartner.com' });
    expect(splitHostTail('independent-tea-80-staging.authkit.app')).toEqual({ head: 'independent-tea-80-staging.', tail: 'authkit.app' });
  });

  it('never loses a character: head + tail is the input', () => {
    for (const text of ['a.b.c.d', 'localhost:3000', 'x.example.com:8443/app', 'example.com', '']) {
      const { head, tail } = splitHostTail(text);
      expect(head + tail).toBe(text);
    }
  });

  it('does not split a short host, a bare host with a port, or a tail that is itself too long', () => {
    expect(splitHostTail('example.com').tail).toBe('');
    expect(splitHostTail('localhost:3000').tail).toBe('');
    expect(splitHostTail('a.this-registrable-domain-is-very-long.com').tail).toBe('');
  });

  it('keeps a port and path with the tail', () => {
    expect(splitHostTail('app.example.com:8443')).toEqual({ head: 'app.', tail: 'example.com:8443' });
  });
});

describe('HostText', () => {
  it('exposes the whole text once, however it is split visually', () => {
    render(<HostText text="staging-app.franchisepartner.com" />);
    expect(screen.getByText('staging-app.franchisepartner.com')).toBeTruthy();
  });

  it('renders an unsplittable host as a single truncating run', () => {
    const { container } = render(<HostText text="localhost:3000" />);
    expect(container.querySelectorAll('[aria-hidden]').length).toBe(0);
    expect(screen.getAllByText('localhost:3000').length).toBe(1);
  });
});
