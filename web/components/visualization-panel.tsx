"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface VisualizationTab<Id extends string> {
  id: Id;
  label: string;
  /** Short description of what the view shows, beside the heading. */
  meta: string;
}

interface VisualizationPanelProps<Id extends string> {
  tabs: VisualizationTab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** The selected view. Only that one is mounted. */
  children: ReactNode;
}

/** Second column of the sandbox: one representation of the model at a time. */
export function VisualizationPanel<Id extends string>({
  tabs,
  selected,
  onSelect,
  children,
}: VisualizationPanelProps<Id>) {
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (offset === 0) {
      return;
    }
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const next = (index + offset + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <section
      className="visualization-panel"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="section-heading">
        <span className="section-index">02</span>
        <h2 id={`${baseId}-heading`}>Visualización</h2>
        <span className="section-meta">{current.meta}</span>
      </div>
      <div
        className="view-tabs"
        role="tablist"
        aria-label="Representación del modelo"
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === current.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.id === current.id ? 0 : -1}
            className="view-tab"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${current.id}`}
        className="view-panel"
      >
        {children}
      </div>
    </section>
  );
}
