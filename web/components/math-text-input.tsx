"use client";

import { useEffect, useRef, useState } from "react";

interface MathTextInputProps {
  value: string;
  label: string;
  className?: string;
  onChange: (value: string) => void;
}

/**
 * Inline text control for editable labels. Same transient-draft contract as
 * MathNumberInput: only non-blank text is committed to the canonical model,
 * so an emptied field never becomes an invalid blank name.
 */
export function MathTextInput({
  value,
  label,
  className,
  onChange,
}: MathTextInputProps) {
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(value);
    }
  }, [value]);

  function handleChange(text: string) {
    setDraft(text);

    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    lastCommitted.current = trimmed;
    onChange(trimmed);
  }

  function handleBlur() {
    setDraft(lastCommitted.current);
  }

  return (
    <input
      type="text"
      className={className ? `math-text-input ${className}` : "math-text-input"}
      aria-label={label}
      value={draft}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      spellCheck={false}
      autoComplete="off"
      style={{ width: `calc(${Math.max(draft.length, 2)}ch + 8px)` }}
    />
  );
}
