import * as Dialog from "@radix-ui/react-dialog";
import * as RSlider from "@radix-ui/react-slider";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Provenance } from "../types";

/** Definition tooltip on an (i) trigger, or around any child (Instructions §53). */
export function Tip({ title, children, text, side = "top" }: { title?: string; text: ReactNode; children?: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root delayDuration={120}>
      <Tooltip.Trigger asChild>
        {children ?? (
          <button className="pn-info" aria-label={title ? `About ${title}` : "More information"}>
            i
          </button>
        )}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="pn-tip" side={side} sideOffset={6} collisionPadding={12}>
          {title && <b>{title}</b>}
          {text}
          <Tooltip.Arrow className="pn-tip__arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <ToggleGroup.Root
      type="single"
      className={`ids-seg pn-seg pn-seg--${size}`}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="ids-seg__opt" aria-checked={o.value === value} title={o.title}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function SliderField({ id, label, value, min, max, step, unit, onChange, hint, prov, disabled }: { id: string; label: ReactNode; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: ReactNode; prov?: Provenance; disabled?: boolean }) {
  return (
    <div className={`pn-field${disabled ? " is-disabled" : ""}`}>
      <div className="pn-field__row">
        <label className="pn-field__label" htmlFor={id}>
          {label} {prov && <Prov kind={prov} />}
        </label>
        <span className="pn-field__value ids-num">
          {Number.isInteger(step) ? value : value.toFixed(1)}
          {unit}
        </span>
      </div>
      <RSlider.Root className="pn-slider" value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} disabled={disabled}>
        <RSlider.Track className="pn-slider__track">
          <RSlider.Range className="pn-slider__range" />
        </RSlider.Track>
        <RSlider.Thumb className="pn-slider__thumb" id={id} aria-label={typeof label === "string" ? label : id} />
      </RSlider.Root>
      {hint && <span className="pn-field__hint">{hint}</span>}
    </div>
  );
}

const PROV_LABEL: Record<Provenance, string> = {
  verified: "verified",
  computed: "computed",
  assumption: "assumption",
};

const PROV_TEXT: Record<Provenance, string> = {
  verified: "Taken directly from a cited source.",
  computed: "Derived from verified inputs by code.",
  assumption: "A user-editable input, not a NASA fact.",
};

export function Prov({ kind }: { kind: Provenance }) {
  return (
    <Tip text={PROV_TEXT[kind]}>
      <span className={`ids-prov pn-prov pn-prov--${kind}`} tabIndex={0}>
        {PROV_LABEL[kind]}
      </span>
    </Tip>
  );
}

export function Modal({ open, onClose, title, subtitle, children, wide }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="pn-overlay" />
        <Dialog.Content className={`pn-modal${wide ? " pn-modal--wide" : ""}`} aria-describedby={undefined}>
          <header className="pn-modal__head">
            <div>
              <Dialog.Title className="pn-modal__title">{title}</Dialog.Title>
              {subtitle && <p className="pn-modal__sub">{subtitle}</p>}
            </div>
            <Dialog.Close className="ids-btn ids-btn--ghost pn-icon-btn" aria-label="Close">
              ✕
            </Dialog.Close>
          </header>
          <div className="pn-modal__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Steps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="ids-steps pn-steps" aria-live="polite">
      {steps.map((s, i) => (
        <li key={s} data-state={i < active ? "done" : i === active ? "active" : "idle"}>
          {s}
          <span className="ids-steps__time" />
        </li>
      ))}
    </ol>
  );
}

/** Tween a displayed number towards its target (motion explains change, §29). */
export function useTween(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    if (!Number.isFinite(a) || !Number.isFinite(target)) {
      // nothing to animate from/to (value still loading): jump
      from.current = target;
      setV(target);
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Num({ value, digits = 0, unit, ms }: { value: number; digits?: number; unit?: string; ms?: number }) {
  const v = useTween(value, ms);
  if (!Number.isFinite(v)) return <span className="pn-num-pending" aria-label="computing">—</span>;
  return (
    <>
      {v.toFixed(digits)}
      {unit && <small>{unit}</small>}
    </>
  );
}

export function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`pn-check ${ok ? "is-ok" : "is-no"}`}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span>
      {label}
      <span className="sr-only">{ok ? " visible" : " not visible"}</span>
    </span>
  );
}
