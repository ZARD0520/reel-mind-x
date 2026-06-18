import { useState } from 'react';

const TABS = ['画面', '音频', '变速'];

interface SliderRowProps {
  label: string;
  value: string;
  percent: number; // 0..100
}

function SliderRow({ label, value, percent }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-fg-secondary">{label}</span>
        <span className="text-[13px] text-fg-tertiary">{value}</span>
      </div>
      <div className="relative h-1 rounded-full bg-timeline-track">
        <div className="h-1 rounded-full bg-accent" style={{ width: `${percent}%` }} />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-fg"
          style={{ left: `calc(${percent}% - 6px)` }}
        />
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const [active, setActive] = useState('画面');

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-border-subtle bg-surface">
      <div className="flex h-[46px] items-center border-b border-border-subtle px-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className={`flex h-full items-center px-3.5 text-sm ${
              tab === active ? 'font-semibold text-fg' : 'text-fg-secondary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-[22px] p-[18px]">
        <section className="flex flex-col gap-3.5">
          <h3 className="text-[13px] font-semibold">变换</h3>
          <SliderRow label="缩放" value="100%" percent={100} />
          <SliderRow label="不透明度" value="100%" percent={100} />
          <SliderRow label="旋转" value="0°" percent={50} />
        </section>

        <section className="flex flex-col gap-3.5">
          <h3 className="text-[13px] font-semibold">画面调节</h3>
          <SliderRow label="亮度" value="50%" percent={50} />
          <SliderRow label="对比度" value="50%" percent={50} />
        </section>
      </div>
    </div>
  );
}
