"use client";

import { Component, type ReactNode } from "react";

interface SceneErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Contains any failure of the 3D renderer (WebGL setup, a render error or a
 * chunk that fails to load) so that the editor, the solver and the geometric
 * view stay usable.
 */
export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Scenario view failed to render.", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
