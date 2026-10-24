import type { HTMLAttributes, FormHTMLAttributes } from 'react';

export function Panel({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={`mb-[23px] overflow-hidden rounded-[10px] border border-border bg-surface [&>[role=alert]]:mx-[22px] [&>[role=alert]]:my-[15px] ${className}`}
    />
  );
}
export function PanelHeading({
  compact = false,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return (
    <div
      {...props}
      className={`flex items-center justify-between gap-[20px] ${compact ? 'pb-[17px]' : 'px-[23px] py-[21px] max-[760px]:p-[18px] [&_p]:mt-[9px] [&_p]:text-[12px] [&_p]:leading-[1.6] [&_p]:text-[#838391] max-[760px]:[&>span]:text-[11px]'} ${className}`}
    />
  );
}
export function Toolbar(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className="flex items-center justify-between gap-[15px] px-[22px] py-[18px] max-[760px]:flex-wrap max-[760px]:p-[15px] [&>[data-select]]:max-w-[150px]"
    />
  );
}
export function SearchForm({
  className = '',
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      {...props}
      className={`flex items-center gap-[10px] text-[#737380] [&_input]:min-w-0 [&_button]:shrink-0 ${className}`}
    />
  );
}
export function ModalBackdrop(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-[24px] backdrop-blur-[4px]"
    />
  );
}
export function Modal({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={`max-h-[90vh] w-[460px] overflow-auto rounded-[13px] border border-[#42424e] bg-[#1c1c24] p-[25px] shadow-[0_24px_80px_#0007] max-[760px]:p-[22px] [&>p]:mb-[12px] [&>p]:text-[12px] ${className}`}
    />
  );
}
export function LoginShell(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_50%_35%,#2b213440,transparent_65%)] p-[25px]"
    />
  );
}
export function LoginCard(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className="w-full max-w-[410px] rounded-[14px] border border-[#33333d] bg-surface p-[35px] [&_h1]:text-[23px] [&_h1_span]:text-[13px] [&_h1_span]:font-normal [&_h1_span]:text-[#a296cf] [&>p]:mt-[11px] [&>p]:mb-[25px] [&>p]:text-[12px] [&>small]:mt-[25px] [&>small]:block [&>small]:text-center [&>small]:text-[11px] [&_form_label]:mb-[20px]"
    />
  );
}
export function BrandMark({
  large = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { large?: boolean }) {
  return (
    <div
      {...props}
      className={`inline-flex shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-[#c1b4ff] ${large ? 'size-[46px]' : 'size-[36px]'}`}
    />
  );
}
