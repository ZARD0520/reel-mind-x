import { Check, ChevronDown } from 'lucide-react';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onValueChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className = '',
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return undefined;

    const updatePlacement = () => {
      const triggerRect = triggerRef.current!.getBoundingClientRect();
      const menuHeight = Math.min(menuRef.current!.scrollHeight, 288);
      const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
      const spaceAbove = triggerRect.top - 8;
      setPlacement(spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom');
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isOpen, options.length]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!isOpen) setPlacement('bottom');
          setIsOpen((open) => !open);
        }}
        disabled={disabled}
        className="flex h-9 max-w-[180px] items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[#b9b9ba] transition-colors hover:bg-white/[0.07] hover:text-[#f7f7f2] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className="truncate">{selected?.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`reel-scroll absolute right-0 z-30 max-h-72 w-64 overflow-y-auto rounded-xl border border-white/[0.12] bg-[#242424] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)] ${placement === 'bottom' ? 'top-11' : 'bottom-11'}`}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onClick={() => {
                  onValueChange(option.value);
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {option.icon && <span className="shrink-0 text-[#b9b9ba]">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#f7f7f2]">{option.label}</span>
                  {option.description && <span className="mt-0.5 block truncate text-xs text-[#7b7b80]">{option.description}</span>}
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-[#f7f7f2]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
