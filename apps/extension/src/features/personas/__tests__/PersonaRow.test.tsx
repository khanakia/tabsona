// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaRow } from '../PersonaRow';
import type { PersonaView, SessionView } from '@/domain/types';

/** Again: no module mocks. The row composes SessionRow directly and still renders. */
const session = (over: Partial<SessionView> = {}): SessionView => ({
  id: 's_1', personaId: 'p_1', site: 'https://sync.localhost', label: 'admin',
  state: 'signed-in', cookieCount: 1, storageKeyCount: 0, domains: [],
  openTabCount: 0, savedAt: 0, lastUsedAt: 0, cookieNames: ['sid'], storageKeys: [],
  expiresAt: null, ...over,
});

const persona = (over: Partial<PersonaView> = {}): PersonaView => ({
  id: 'p_1', name: 'Acme admin', description: '', color: '#3b82f6',
  sessions: [session()], openTabCount: 0, lastUsedAt: 0, ...over,
});

const noop = {
  onToggle: () => undefined, onOpenAll: () => undefined, onUpdate: () => undefined,
  onDuplicate: () => undefined, onDelete: () => undefined, onAddSite: () => undefined,
  onOpenSession: () => undefined, onRenameSession: () => undefined, onDeleteSession: () => undefined,
};

describe('PersonaRow', () => {
  it('shows how many sites the persona holds', () => {
    render(<PersonaRow persona={persona()} expanded={false} {...noop} />);
    expect(screen.getByText('1 site')).toBeTruthy();
  });

  it('hides its sessions until expanded', () => {
    const { rerender } = render(<PersonaRow persona={persona()} expanded={false} {...noop} />);
    expect(screen.queryByText('sync.localhost')).toBeNull();
    rerender(<PersonaRow persona={persona()} expanded {...noop} />);
    expect(screen.getByText('sync.localhost')).toBeTruthy();
  });

  it('opens the whole persona — the feature that justifies personas existing', () => {
    const onOpenAll = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onOpenAll={onOpenAll} />);
    fireEvent.click(screen.getByText('Open all'));
    expect(onOpenAll).toHaveBeenCalledWith('p_1');
  });

  it('disables open-all for a persona with no sites, rather than opening nothing', () => {
    render(<PersonaRow persona={persona({ sessions: [] })} expanded {...noop} />);
    expect(screen.getByText('Open all').closest('button')?.hasAttribute('disabled')).toBe(true);
  });

  it('tells an empty persona what to do instead of showing a blank list', () => {
    render(<PersonaRow persona={persona({ sessions: [] })} expanded {...noop} />);
    expect(screen.getByText(/No sites yet/)).toBeTruthy();
  });

  it('forwards a session open, including which target was chosen', () => {
    const onOpenSession = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onOpenSession={onOpenSession} />);
    fireEvent.click(screen.getByLabelText('Open in the tab you are on'));
    expect(onOpenSession).toHaveBeenCalledWith('s_1', 'this-tab');
  });

  it('shows a description when the persona has one', () => {
    render(<PersonaRow persona={persona({ description: 'Staging stack, admin role' })} expanded {...noop} />);
    expect(screen.getByText('Staging stack, admin role')).toBeTruthy();
  });

  it('edits name and description together, and only sends what changed', () => {
    // One patch rather than two callbacks, so a save never half-applies.
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));

    fireEvent.change(screen.getByLabelText('Describe Acme admin'), {
      target: { value: 'Staging stack' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(onUpdate).toHaveBeenCalledWith('p_1', { description: 'Staging stack' });
  });

  it('sends nothing when the editor is saved unchanged', () => {
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    fireEvent.click(screen.getByText('Save'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('discards edits on cancel', () => {
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    fireEvent.change(screen.getByLabelText('Rename Acme admin'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Rename Acme admin')).toBeNull();
  });

  it('clears a description when it is emptied, rather than ignoring the edit', () => {
    // '' must reach the engine: clearing a description is a real edit, which is why the
    // patch fields are optional rather than nullable.
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona({ description: 'old text' })} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    fireEvent.change(screen.getByLabelText('Describe Acme admin'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onUpdate).toHaveBeenCalledWith('p_1', { description: '' });
  });

  it('saves on Enter and cancels on Escape', () => {
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    const nameInput = screen.getByLabelText('Rename Acme admin');
    fireEvent.change(nameInput, { target: { value: 'Acme staging' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith('p_1', { name: 'Acme staging' });

    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    fireEvent.keyDown(screen.getByLabelText('Rename Acme admin'), { key: 'Escape' });
    expect(screen.queryByLabelText('Rename Acme admin')).toBeNull();
  });

  it('keeps the existing name when the field is blanked', () => {
    // A persona with no name is unusable, so a blank name is ignored — unlike a blank
    // description, which is a legitimate clear.
    const onUpdate = vi.fn();
    render(<PersonaRow persona={persona()} expanded {...noop} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Edit Acme admin'));
    fireEvent.change(screen.getByLabelText('Rename Acme admin'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
