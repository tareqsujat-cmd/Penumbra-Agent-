/** Minimal, safe renderer for assistant replies: paragraphs, "- " / "1. " lists, **bold** and _italic_.
 *  Builds React elements only (never innerHTML), so model output cannot inject markup. Known technical words can
 *  be turned into buttons that explain them (the built-in guide's tap-to-explain). */
import type { ReactNode } from "react";

export type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, ""); // headings are not used; show them as plain text
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flush();
      const kind = b ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      const item = (b ?? n)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (!line.trim()) {
      flush();
    } else {
      const last = blocks[blocks.length - 1];
      // an indented continuation line belongs to the previous list item
      if (!para.length && last && last.kind !== "p" && /^\s{2,}\S/.test(raw)) last.items[last.items.length - 1] += " " + line.trim();
      else para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** A technical word to make tappable: `match` finds it in text, `id` is passed back on tap. */
export interface TermLink {
  match: RegExp;
  id: string;
}

interface Linker {
  terms: TermLink[];
  onTerm: (id: string, word: string) => void;
  /** words already linked in this message (each is linked once) */
  used: Set<string>;
}

function linkTerms(text: string, key: string, l?: Linker): ReactNode[] {
  if (!l || !l.terms.length) return [text];
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  for (;;) {
    let best: { i: number; len: number; id: string; word: string } | null = null;
    for (const t of l.terms) {
      if (l.used.has(t.id)) continue;
      const m = new RegExp(t.match.source, t.match.flags.includes("i") ? "i" : "").exec(rest);
      if (m && (!best || m.index < best.i)) best = { i: m.index, len: m[0].length, id: t.id, word: m[0] };
    }
    if (!best) break;
    if (best.i > 0) out.push(rest.slice(0, best.i));
    const { id, word } = best;
    l.used.add(id);
    out.push(
      <button key={`${key}-t${k++}`} type="button" className="pn-asst__term" onClick={() => l.onTerm(id, word)} title={`What does “${word}” mean?`}>
        {word}
      </button>,
    );
    rest = rest.slice(best.i + best.len);
  }
  if (rest) out.push(rest);
  return out;
}

export function inline(text: string, l?: Linker): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_|\*[^*\s][^*]*\*)/g).flatMap((part, i): ReactNode[] => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return [<strong key={i}>{linkTerms(part.slice(2, -2), `b${i}`, l)}</strong>];
    if (((part.startsWith("_") && part.endsWith("_")) || (part.startsWith("*") && part.endsWith("*"))) && part.length > 2) return [<em key={i}>{part.slice(1, -1)}</em>];
    return linkTerms(part.replace(/`/g, ""), `s${i}`, l).map((n, j) => (typeof n === "string" ? n : <span key={`${i}-${j}`}>{n}</span>));
  });
}

export function Markdown({ text, terms, onTerm }: { text: string; terms?: TermLink[]; onTerm?: (id: string, word: string) => void }) {
  const l: Linker | undefined = terms && onTerm ? { terms, onTerm, used: new Set() } : undefined;
  return (
    <>
      {parseBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.text, l)}</p>
        ) : b.kind === "ul" ? (
          <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, l)}</li>)}</ul>
        ) : (
          <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, l)}</li>)}</ol>
        ),
      )}
    </>
  );
}
