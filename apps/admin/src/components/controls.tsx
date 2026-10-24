import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

const buttonVariants = {
  default:
    'border-[#34343e] bg-[#24242c] enabled:hover:border-[#555465] enabled:hover:bg-[#32323e]',
  primary:
    'border-accent bg-accent font-semibold enabled:hover:border-accent-hover enabled:hover:bg-accent-hover',
  ghost:
    'border-[#34343e] bg-transparent enabled:hover:border-[#555465] enabled:hover:bg-[#32323e]',
  icon: 'min-w-[32px] border-transparent bg-transparent enabled:hover:border-[#555465] enabled:hover:bg-[#32323e]',
};
const buttonSizes = {
  default: 'min-h-[34px] px-[12px] py-[7px]',
  small: 'min-h-[28px] px-[7px] py-[4px] text-[11px]',
  pagination: 'min-h-[29px] px-[12px] py-[7px] text-[11px]',
  icon: 'min-h-[34px] p-[7px]',
};

export function Button({
  variant = 'default',
  size = 'default',
  danger = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  danger?: boolean;
}) {
  const color = danger
    ? 'text-[#f39ca4]'
    : variant === 'primary'
      ? 'text-[#1e1639]'
      : 'text-[#dedee7]';
  return (
    <button
      {...props}
      className={`inline-flex cursor-pointer items-center justify-center gap-[7px] rounded-[7px] border transition-colors duration-150 outline-offset-4 disabled:cursor-not-allowed disabled:opacity-45 ${buttonVariants[variant]} ${buttonSizes[size]} ${color} ${className}`}
    />
  );
}

const controlClass =
  'min-h-[40px] rounded-[7px] border border-[#35353f] bg-input px-[11px] py-[9px] text-[#ededf2] outline-offset-4 placeholder:text-[#757580] focus:border-[#a498f5] focus:outline-2 focus:outline-[#a498f526]';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }
>(function Input({ className = '', type, compact = false, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type={type}
      className={`${type === 'checkbox' ? 'h-[16px] min-h-[16px] w-[16px] accent-accent' : `${controlClass} ${compact ? 'w-[130px]' : 'w-full'}`} ${className}`}
    />
  );
});
export interface SelectOption {
  value: string;
  label: string;
}
/**
 * 通用下拉选择框：自定义弹层，替代原生 select。
 * 受控传 value + onChange(value)；非受控传 defaultValue（可通过 name 以表单提交读取）。
 */
export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  placeholder = '请选择',
  className = '',
  ...rest
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'>) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = value !== undefined ? value : uncontrolled;
  const selected = options.find((option) => option.value === current);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((option) => option.value === current)));
  }, [open, current, options]);
  const choose = (option: SelectOption) => {
    setOpen(false);
    if (option.value !== current) {
      if (value === undefined) setUncontrolled(option.value);
      onChange?.(option.value);
    }
  };
  return (
    <div
      {...rest}
      ref={rootRef}
      data-select=""
      className={`relative ${disabled ? 'pointer-events-none opacity-45' : ''} ${className}`}
      onKeyDown={(event) => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          setOpen(true);
        } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((index) => (index + step + options.length) % options.length);
        } else if (open && event.key === 'Enter') {
          event.preventDefault();
          const option = options[active];
          if (option) choose(option);
        }
      }}
    >
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${controlClass} flex w-full cursor-pointer items-center gap-[8px] text-left`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-[#757580]'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-[#858593] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-[calc(100%+4px)] left-0 z-30 max-h-[248px] w-full min-w-[130px] overflow-auto rounded-[7px] border border-[#3a3a46] bg-[#24242c] py-[5px] shadow-[0_10px_34px_#000a]"
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === current}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
              className={`flex w-full cursor-pointer items-center justify-between gap-[8px] px-[11px] py-[8px] text-left text-[12px] ${index === active ? 'bg-[#32323e]' : ''} ${option.value === current ? 'text-[#c1b4ff]' : 'text-[#dedee7]'}`}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === current && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={`w-full ${controlClass} min-h-[90px] resize-y ${className}`} />
  );
}
export function Field({
  variant = 'default',
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { variant?: 'default' | 'setting' | 'checkbox' }) {
  const variantClass =
    variant === 'setting'
      ? 'm-0 grid gap-[9px] text-[11px]'
      : variant === 'checkbox'
        ? 'my-[18px] flex items-center gap-[9px] text-[13px]'
        : 'my-[18px] grid gap-[9px] text-[13px]';
  return <label {...props} className={`text-[#c1c1cb] ${variantClass} ${className}`} />;
}
