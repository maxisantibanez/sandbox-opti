"use client";

import { useEffect, useRef, useState } from "react";

import {
  formatEditableNumber,
  parseEditableNumber,
} from "@/lib/number-input";

interface MathNumberInputProps {
  value: number;
  label: string;
  onChange: (value: number) => void;
}

/**
 * Inline numeric control. The draft text is local and transient: only complete,
 * finite numbers are committed to the canonical model, so an empty field never
 * becomes an accidental zero.
 */
export function MathNumberInput({
  value,
  label,
  onChange,
}: MathNumberInputProps) {
  const [draft, setDraft] = useState(() => formatEditableNumber(value));
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(formatEditableNumber(value));
    }
  }, [value]);

  function handleChange(text: string) {
    setDraft(text);

    const parsed = parseEditableNumber(text);
    if (parsed === null) {
      return;
    }

    lastCommitted.current = parsed;
    onChange(parsed);
  }

  function handleBlur() {
    setDraft(formatEditableNumber(lastCommitted.current));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className="math-input"
      aria-label={label}
      value={draft}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      spellCheck={false}
      autoComplete="off"
      style={{ width: `calc(${Math.max(draft.length, 1)}ch + 8px)` }}
    />
  );
}
