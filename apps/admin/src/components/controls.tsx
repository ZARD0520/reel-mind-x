import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

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
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full ${controlClass} ${className}`} />;
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
