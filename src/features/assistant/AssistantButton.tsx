import { setState, useApp } from "../../state/store";

/** Header toggle for the assistant panel. */
export function AssistantButton() {
  const open = useApp((s) => s.assistantOpen);
  return (
    <button
      className={`ids-btn pn-hdr__ask${open ? " is-on" : ""}`}
      onClick={() => setState({ assistantOpen: !open })}
      aria-expanded={open}
      aria-controls="pn-assistant"
      title="Ask the assistant how to use Penumbra or what your results mean"
    >
      <span className="pn-hdr__ask-dot" aria-hidden="true" />
      Ask
    </button>
  );
}
