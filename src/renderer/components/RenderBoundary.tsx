import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface RenderBoundaryProps {
  /** Shown in place of the children when one of them fails to render. */
  fallback: ReactNode;
  /** When this changes (a different document arrived), the children get another try. */
  resetKey?: unknown;
  children: ReactNode;
}

interface RenderBoundaryState {
  failed: boolean;
  resetKey: unknown;
}

/**
 * Stops one part of the page that cannot be drawn from taking the rest down with it.
 *
 * React removes everything below the nearest boundary when a component throws while rendering,
 * and with no boundary that is the whole interface. A hostile or merely unusual document can make
 * the Markdown parser throw (for example by nesting thousands of levels deep), so each piece of a
 * document is drawn inside one of these.
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  override state: RenderBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<RenderBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: RenderBoundaryProps,
    state: RenderBoundaryState,
  ): Partial<RenderBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[render] a part of the page could not be drawn', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
