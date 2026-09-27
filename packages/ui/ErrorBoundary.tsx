// What stands in for a screen that failed to draw. React leaves the page blank
// when a render throws, and the person using it has no way to see why: this
// draws the app's own fallback instead, which says so and offers a way on.
//
// Each app puts one round each screen, keyed by its path so a failure stays
// behind when the person moves on, and one round the whole app. React has no
// hook for this, so it is the one class component.

import { Component, type ReactNode } from "react";

interface Props {
  /** What the app draws in the screen's place: its words, and a reload or a way home. */
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
