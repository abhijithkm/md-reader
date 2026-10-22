import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderBoundary } from './RenderBoundary';

function Bomb({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  // React reports a caught render error on the console; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RenderBoundary', () => {
  it('shows its children when nothing goes wrong', () => {
    render(
      <RenderBoundary fallback={<p>fallback</p>}>
        <p>fine</p>
      </RenderBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).toBeNull();
  });

  it('shows the fallback when a child fails to render, and leaves the rest of the page alone', () => {
    render(
      <div>
        <p>before</p>
        <RenderBoundary fallback={<p>fallback</p>}>
          <Bomb />
        </RenderBoundary>
        <p>after</p>
      </div>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.getByText('before')).toBeInTheDocument();
    expect(screen.getByText('after')).toBeInTheDocument();
  });

  it('tries again when its key changes, for example when a different document arrives', () => {
    const { rerender } = render(
      <RenderBoundary fallback={<p>fallback</p>} resetKey="first">
        <Bomb />
      </RenderBoundary>,
    );
    expect(screen.getByText('fallback')).toBeInTheDocument();

    rerender(
      <RenderBoundary fallback={<p>fallback</p>} resetKey="second">
        <p>recovered</p>
      </RenderBoundary>,
    );

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).toBeNull();
  });

  it('stays on the fallback while the key is the same', () => {
    const { rerender } = render(
      <RenderBoundary fallback={<p>fallback</p>} resetKey="same">
        <Bomb />
      </RenderBoundary>,
    );

    rerender(
      <RenderBoundary fallback={<p>fallback</p>} resetKey="same">
        <p>should not appear</p>
      </RenderBoundary>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.queryByText('should not appear')).toBeNull();
  });
});
