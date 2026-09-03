'use client';

/**
 * The Proof launcher: Proof is reachable from every page, not only from
 * inside a reservation. One floating button, one overlay, the same chat the
 * hero embeds.
 *
 * It sits bottom-left so it never collides with the task screen's inspector
 * button (bottom-right), and it closes on Escape or a backdrop tap. The
 * button carries the same ever-turning dashed ring as Proof's avatar in the
 * chat — the assistant is present on every page, and visibly awake.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { ProofConsole } from './proof-console';

export function ProofLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Any screen can summon the console — e.g. the reservation page's
    // "Ask Proof for help" button — without wiring props through the tree.
    const onSummon = () => setOpen(true);
    window.addEventListener('proof:open', onSummon);
    return () => window.removeEventListener('proof:open', onSummon);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Ask Proof for help with your stay"
        className="group fixed bottom-6 left-6 z-40 flex items-center gap-3 rounded-full bg-[#17181b]/90 py-2 pl-4 pr-5 text-sm font-medium text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/25 backdrop-blur-xl transition hover:scale-[1.03]"
      >
        <span className="relative flex size-7 items-center justify-center">
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-dashed border-white/35"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          />
          <Sparkles size={13} aria-hidden />
        </span>
        Ask Proof
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Proof"
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b0c0e]/60 p-4 backdrop-blur-md sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="h-[min(760px,90dvh)] w-full max-w-xl">
            <ProofConsole onClose={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
