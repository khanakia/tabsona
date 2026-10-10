// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NormalLogin } from '../NormalLogin';
import { ACTION_HELP } from '@/ui/help';

/** No module mocks: rendered from plain props, `vi` only for spies. */

afterEach(cleanup);

const setup = (hosts: readonly string[] = []) => {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(<NormalLogin hosts={hosts} onAdd={onAdd} onRemove={onRemove} />);
  return { onAdd, onRemove };
};

describe('NormalLogin — the "use my normal login on" list', () => {
  it('starts empty and says so: nothing is on the list until the user adds it', () => {
    setup();
    expect(screen.getByText('None yet.')).toBeTruthy();
  });

  it('shows the default sites and "Restore default sites" even when the list is empty', () => {
    const { onAdd } = setup();
    const defaults = screen.getByRole('list', { name: 'Default sites' });
    expect(defaults.textContent).toContain('accounts.google.com');
    expect(defaults.textContent).toContain('accounts.youtube.com');
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.addGoogleSignInSites.label }));
    expect(onAdd).toHaveBeenCalledWith(['accounts.google.com', 'accounts.youtube.com']);
  });

  it('restores only the defaults the user removed, leaving their own entries alone', () => {
    const { onAdd } = setup(['accounts.google.com', 'localhost:8790']);
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.addGoogleSignInSites.label }));
    expect(onAdd).toHaveBeenCalledWith(['accounts.youtube.com']);
  });

  it('keeps the button visible but disabled, with a hint, once every default is present', () => {
    const { onAdd } = setup(['accounts.google.com', 'accounts.youtube.com']);
    const button = screen.getByRole('button', { name: ACTION_HELP.addGoogleSignInSites.label }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('All default sites are already on your list.')).toBeTruthy();
  });

  it('adds what was typed, in its canonical form, on the button or on Enter', () => {
    const { onAdd } = setup();
    const input = screen.getByLabelText('Website to use your normal login on');
    fireEvent.change(input, { target: { value: 'https://Accounts.Google.co.in/signin' } });
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.addNormalLogin.label }));
    expect(onAdd).toHaveBeenLastCalledWith(['accounts.google.co.in']);
    fireEvent.change(input, { target: { value: 'login.example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenLastCalledWith(['login.example.com']);
  });

  it('refuses something that is not a website: the button is disabled and the reason is shown', () => {
    const { onAdd } = setup();
    const input = screen.getByLabelText('Website to use your normal login on');
    fireEvent.change(input, { target: { value: 'not a website' } });
    expect((screen.getByRole('button', { name: ACTION_HELP.addNormalLogin.label }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('not a website address');
  });

  it('lists each entry with its own Remove', () => {
    const { onRemove } = setup(['accounts.google.com', 'localhost:8790']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove localhost:8790' }));
    expect(onRemove).toHaveBeenCalledWith('localhost:8790');
  });
});
