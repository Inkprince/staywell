'use client';

/**
 * The browser side of the pilot's NDJSON stream: one call, one callback per
 * step, and the engine name back. Shared by the task screen's panel and the
 * homepage's live demo.
 */

export interface PilotStreamStep {
  note?: string;
  outcome?: 'ok' | 'error' | 'needs-you';
  engine?: string;
  taskId?: string;
}

export async function streamPilot(
  taskId: string,
  onStep: (step: PilotStreamStep) => void,
  signal?: AbortSignal,
): Promise<{ started: boolean; engine: string | null }> {
  try {
    const response = await fetch('/api/pilot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
      signal,
    });

    if (!response.ok || !response.body) {
      let why = `the pilot could not start (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) why = body.error;
      } catch {
        // keep the status-line message
      }
      onStep({ note: why, outcome: 'error' });
      return { started: false, engine: null };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let engine: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const step = JSON.parse(line) as PilotStreamStep;
          if (!step.note) {
            // The opening line: which engine is running.
            if (step.engine) engine = step.engine;
            continue;
          }
          onStep(step);
        } catch {
          // A partial line never reaches us — the buffer holds it back.
        }
      }
    }

    return { started: true, engine };
  } catch {
    if (!signal?.aborted) {
      onStep({ note: 'The connection dropped. Nothing was changed.', outcome: 'error' });
    }
    return { started: false, engine: null };
  }
}
