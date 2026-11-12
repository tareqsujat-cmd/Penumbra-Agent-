/** Conversation history sent to the backend: text turns, with a note on what happened to each proposal so the
 *  assistant knows whether its suggested change was applied (the guide tells it these notes come from the app). */
import type { ChatTurn } from "../../api/assistant";
import type { Proposal, UndoSnapshot } from "./applyProposal";

export type ProposalStatus = "pending" | "applying" | "applied" | "dismissed" | "failed" | "undone";

export interface ProposalState extends Proposal {
  status: ProposalStatus;
  error?: string;
  /** the settings before it was applied (for Undo) */
  undo?: UndoSnapshot;
}

export interface HistoryMsg extends ChatTurn {
  pending?: boolean;
  error?: string;
  proposals?: ProposalState[];
}

export function proposalNote(p: ProposalState): string {
  const what = `"${p.summary}" (${p.lines.join("; ")})`;
  switch (p.status) {
    case "applied":
      return `[The person applied this change: ${what}]`;
    case "dismissed":
      return `[The person dismissed this proposal: ${what}]`;
    case "undone":
      return `[The person applied, then undid this change: ${what}]`;
    case "failed":
      return `[Applying this proposal failed: ${what}. Error: ${p.error ?? "unknown"}]`;
    default:
      return `[This proposal is still waiting for the person: ${what}]`;
  }
}

export function toHistory(msgs: HistoryMsg[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const m of msgs) {
    if (m.pending || m.error) continue;
    const notes = (m.proposals ?? []).map(proposalNote);
    const content = [m.content.trim(), ...notes].filter(Boolean).join("\n\n");
    if (content) out.push({ role: m.role, content });
  }
  return out;
}
