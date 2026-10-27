"use client";

import { categoryLabel } from "@/lib/scenario";
import { TEMPLATES, type Template } from "@/lib/templates";

interface ModelStartProps {
  onBlank: () => void;
  onTemplate: (template: Template) => void;
  /** Present when a model already exists, so the user can keep editing it. */
  onCancel?: () => void;
  /** A choice waiting for confirmation because the current model has unsaved changes. */
  replacement?: { title: string; onConfirm: () => void } | null;
}

export function ModelStart({ onBlank, onTemplate, onCancel, replacement }: ModelStartProps) {
  return (
    <section className="model-start" aria-labelledby="start-heading">
      <div className="section-heading">
        <span className="section-index">00</span>
        <h2 id="start-heading">Nuevo modelo</h2>
        {onCancel ? (
          <button type="button" className="text-button section-action" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>

      {replacement ? (
        <div className="replace-notice" role="group" aria-label="Confirmar reemplazo del modelo">
          <p>El modelo actual tiene cambios sin conservar.</p>
          <div className="replace-actions">
            <button type="button" className="text-button" onClick={replacement.onConfirm}>
              Reemplazar por {replacement.title}
            </button>
            {onCancel ? (
              <button type="button" className="text-button" onClick={onCancel}>
                Cancelar
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <ul className="start-options">
        <li>
          <button type="button" className="start-option" onClick={onBlank}>
            <span className="start-option-name">En blanco</span>
            <span className="start-option-meta">Sin semántica · LP continuo</span>
          </button>
        </li>
      </ul>

      <p className="start-group-label">Templates</p>
      <ul className="start-options">
        {TEMPLATES.map((template) => {
          const { metadata } = template.scenario;

          return (
            <li key={metadata.id}>
              <button
                type="button"
                className="start-option"
                onClick={() => onTemplate(template)}
              >
                <span className="start-option-name">{metadata.name}</span>
                <span className="start-option-meta">
                  {categoryLabel(metadata.category)} · LP continuo
                </span>
                <span className="start-option-description">{metadata.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
