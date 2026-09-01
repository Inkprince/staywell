/**
 * Tools Proof deliberately does not expose to agents, and why.
 *
 * This list is not documentation-only: it is rendered in the inspector and
 * returned by the `describe_proof_tools` tool, so an agent asking what it can do
 * here gets a truthful answer about where its authority ends.
 *
 * The absence is enforced structurally, not by convention — `tests/boundaries.test.ts`
 * asserts that nothing reachable from `src/webmcp/` can call the commit or
 * approval paths.
 */

export interface WithheldTool {
  name: string;
  reason: string;
}

export const WITHHELD_TOOLS: readonly WithheldTool[] = [
  {
    name: 'approve_change',
    reason:
      'Approval is the human’s decision. It is only reachable from a real click in the interface, using a one-time token that is never returned by any tool.',
  },
  {
    name: 'commit_change',
    reason:
      'Committing follows approval and is performed by the application, not the agent. An agent can prepare and stage a change; it cannot apply one.',
  },
  {
    name: 'set_verified',
    reason:
      'Nothing may declare its own success. A task becomes verified only when the application re-reads its own state and finds it matches what was asked.',
  },
  {
    name: 'edit_constraints_silently',
    reason:
      'Constraints belong to the person who set them. An agent can propose a change to them, which appears in the interface for review.',
  },
] as const;
