// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ColorSwatches } from '../ColorSwatches';
import { PERSONA_PALETTE } from '@/core/constants';

/** No module mocks: the swatches render from the palette constant alone. */
describe('ColorSwatches', () => {
  it('offers every palette colour, one radio each', () => {
    render(<ColorSwatches value="#3b82f6" onPick={() => undefined} />);
    expect(screen.getAllByRole('radio')).toHaveLength(PERSONA_PALETTE.length);
  });

  it('marks exactly the current colour as selected, ignoring hex case', () => {
    render(<ColorSwatches value="#EF4444" onPick={() => undefined} />);
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.getAttribute('aria-label'))).toEqual(['Red']);
  });

  it('reports the picked colour as its palette hex', () => {
    const onPick = vi.fn();
    render(<ColorSwatches value="#3b82f6" onPick={onPick} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Cyan' }));
    expect(onPick).toHaveBeenCalledWith('#14b8a6');
  });
});
