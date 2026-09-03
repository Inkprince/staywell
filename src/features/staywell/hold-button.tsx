'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A button that fires only when pressed and held for a full second.
 *
 * It guards the guest's own "I'll do it myself" changes. The point is
 * deliberate friction: a person commits by holding, while a single tap —
 * or a single synthetic click from a browsing agent driving the page —
 * does nothing. That is friction, not proof of humanity, and nothing here
 * claims otherwise; the real guarantees live in the tool surface.
 */
export function HoldButton({
  label,
  holdingLabel,
  onHold,
  disabled,
  className,
}: {
  label: string;
  holdingLabel: string;
  onHold: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  const settled = useRef(false);

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!settled.current) setProgress(0);
  }, []);

  const begin = useCallback(() => {
    if (disabled) return;
    settled.current = false;
    const start = performance.now();
    const tick = () => {
      const next = Math.min(1, (performance.now() - start) / 1000);
      setProgress(next);
      if (next >= 1) {
        settled.current = true;
        setProgress(0);
        onHold();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [disabled, onHold]);

  useEffect(() => () => cancel(), [cancel]);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          begin();
        }
      }}
      onKeyUp={cancel}
      className={`relative select-none overflow-hidden touch-none ${className ?? ''}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-white/25 transition-none"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative">{progress > 0 ? holdingLabel : label}</span>
    </button>
  );
}
