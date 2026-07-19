import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectDropdownProps {
  value: string;
  options: readonly SelectOption[];
  ariaLabel: string;
  onChange: (value: string) => void;
}

export function SelectDropdown({ value, options, ariaLabel, onChange }: SelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, []);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  };

  const move = (direction: 1 | -1) => {
    setOpen(true);
    setActiveIndex((current) => (current + direction + options.length) % options.length);
  };

  return <div className={`select-dropdown${open ? " is-open" : ""}`} ref={rootRef}>
    <button
      type="button"
      className="select-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
      onClick={() => { setActiveIndex(selectedIndex); setOpen((current) => !current); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") { event.preventDefault(); setOpen(true); setActiveIndex(0); }
        else if (event.key === "End") { event.preventDefault(); setOpen(true); setActiveIndex(options.length - 1); }
        else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(activeIndex); }
        else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      }}
    >
      <span>{selected?.label}</span>
      <svg className="select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
    </button>
    {open && <div className="select-popover" id={listId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button
        type="button"
        id={`${listId}-option-${index}`}
        key={option.value}
        className={`select-option${index === activeIndex ? " is-active" : ""}${option.value === value ? " is-selected" : ""}`}
        role="option"
        aria-selected={option.value === value}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => choose(index)}
      >
        <span>{option.label}</span>
        {option.value === value && <svg className="select-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>}
      </button>)}
    </div>}
  </div>;
}
