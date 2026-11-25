import React from 'react';
import { LiquidTankComputed } from '../types';

interface LiquidTankSvgProps {
  tank: LiquidTankComputed;
}

export const LiquidTankSvg: React.FC<LiquidTankSvgProps> = ({ tank }) => {
  const uid = `liq-t${tank.id}`;
  const cylX = 56;
  const cylW = 148;
  const cylTopY = 86;
  const cylBottomY = 318;
  const cylHeight = 232;
  const rx = 74;
  const ry = 18;
  const cx = cylX + rx;

  const fillPct = tank.filledPercentage;
  const liqH = (cylHeight * fillPct) / 100;
  const liqTopY = cylBottomY - liqH;
  const pointerY = Math.min(cylBottomY - 6, Math.max(cylTopY, liqTopY));

  const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => {
    const y = cylBottomY - cylHeight * ratio;
    const meters = (tank.depthMeters * ratio).toFixed(ratio === 0 || ratio === 1 ? 0 : 1);
    return { ratio, y, meters };
  });

  const labelSlice = tank.productLabel.length > 22 ? `${tank.productLabel.slice(0, 21)}…` : tank.productLabel;

  return (
    <svg
      viewBox="0 0 280 368"
      className="w-full max-w-[230px] h-auto select-none"
      role="img"
      aria-label={`${tank.name} ${fillPct.toFixed(1)}% full`}
    >
      <defs>
        <linearGradient id={`shell-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#94A3B8" />
          <stop offset="25%" stopColor="#F8FAFC" />
          <stop offset="75%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#64748B" />
        </linearGradient>
        <linearGradient id={`empty-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#CBD5E1" />
          <stop offset="40%" stopColor="#E2E8F0" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>
        <linearGradient id={`liq-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0369A1" />
          <stop offset="45%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#075985" />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <path
            d={`M ${cylX} ${cylTopY} A ${rx} ${ry} 0 0 1 ${cylX + cylW} ${cylTopY} L ${cylX + cylW} ${cylBottomY} A ${rx} ${ry} 0 0 1 ${cylX} ${cylBottomY} Z`}
          />
        </clipPath>
      </defs>

      {/* Base Plinth */}
      <rect x={cylX - 8} y={cylBottomY + 4} width={cylW + 16} height={14} rx={3} fill="#475569" />
      <rect x={cylX - 12} y={cylBottomY + 14} width={cylW + 24} height={6} rx={2} fill="#334155" />

      {/* Top Inward Inlet Pipe & Valve */}
      <path
        d={`M 16 ${cylTopY - 16} L 70 ${cylTopY - 16} L 70 ${cylTopY - 8}`}
        fill="none"
        stroke="#16A34A"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <rect x={28} y={cylTopY - 23} width={12} height={14} rx={2} fill="#15803D" />
      <text
        x={16}
        y={cylTopY - 29}
        fontSize={9}
        fontWeight={600}
        fill="#16A34A"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        INWARD
      </text>

      {/* Bottom Outward Outlet Pipe & Valve */}
      <path
        d={`M ${cylX + cylW - 4} ${cylBottomY - 12} L 244 ${cylBottomY - 12}`}
        fill="none"
        stroke="#DC2626"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <circle cx={cylX + cylW + 16} cy={cylBottomY - 12} r={7} fill="#DC2626" stroke="#991B1B" strokeWidth={2} />
      <text
        x={210}
        y={cylBottomY - 22}
        fontSize={9}
        fontWeight={600}
        fill="#DC2626"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        OUTWARD
      </text>

      {/* Tank Outer Shell */}
      <path
        d={`M ${cylX - 5} ${cylTopY} L ${cylX - 5} ${cylBottomY} A ${rx + 5} ${ry + 2} 0 0 0 ${cylX + cylW + 5} ${cylBottomY} L ${cylX + cylW + 5} ${cylTopY} Z`}
        fill={`url(#shell-${uid})`}
        stroke="#64748B"
        strokeWidth={1.2}
      />

      {/* Clipped Liquid Chamber */}
      <g clipPath={`url(#clip-${uid})`}>
        <rect x={cylX} y={cylTopY - ry} width={cylW} height={cylHeight + ry * 2} fill={`url(#empty-${uid})`} />
        {fillPct > 0 && (
          <>
            <rect x={cylX} y={liqTopY} width={cylW} height={liqH + ry + 4} fill={`url(#liq-${uid})`} />
            <ellipse cx={cx} cy={liqTopY} rx={rx} ry={13} fill="#7DD3FC" stroke="#BAE6FD" strokeWidth={1.2} />
          </>
        )}
        <rect x={cylX + 14} y={cylTopY - ry} width={14} height={cylHeight + ry * 2} fill="#FFFFFF" fillOpacity={0.2} />
      </g>

      {/* Tank Nameplate */}
      <rect
        x={cx - 72}
        y={6}
        width={144}
        height={32}
        rx={5}
        fill="#0F172A"
        fillOpacity={0.92}
        stroke="#475569"
        strokeWidth={1}
      />
      <text
        x={cx}
        y={19}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={700}
        fill="#F8FAFC"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {tank.name}
      </text>
      <text
        x={cx}
        y={31}
        textAnchor="middle"
        fontSize={8.5}
        fontWeight={600}
        fill="#38BDF8"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {labelSlice}
      </text>

      {/* Dome Roof & Vent Nozzle */}
      <path
        d={`M ${cylX - 5} ${cylTopY} A ${rx + 5} ${ry + 16} 0 0 1 ${cylX + cylW + 5} ${cylTopY} A ${rx + 5} ${ry} 0 0 1 ${cylX - 5} ${cylTopY} Z`}
        fill="#CBD5E1"
        stroke="#64748B"
        strokeWidth={1.2}
      />
      <ellipse cx={cx} cy={cylTopY - 12} rx={18} ry={6} fill="#64748B" />
      <rect x={cx - 4} y={cylTopY - 22} width={8} height={10} rx={1} fill="#475569" />

      {/* Depth Ruler */}
      <line x1={cylX - 14} y1={cylTopY} x2={cylX - 14} y2={cylBottomY} stroke="#64748B" strokeWidth={1.2} />
      {ticks.map((tick) => (
        <g key={tick.ratio}>
          <line x1={cylX - 19} y1={tick.y} x2={cylX - 14} y2={tick.y} stroke="#64748B" strokeWidth={1.2} />
          <text
            x={cylX - 22}
            y={tick.y + 3}
            textAnchor="end"
            fontSize={9}
            fill="#64748B"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {tick.meters}m
          </text>
        </g>
      ))}

      {/* Level Pointer Indicator */}
      <g transform={`translate(0, ${pointerY})`}>
        <polygon
          points={`${cylX + cylW + 7},0 ${cylX + cylW + 15},-5 ${cylX + cylW + 15},5`}
          fill="#0284C7"
        />
        <rect x={cylX + cylW + 16} y={-12} width={52} height={24} rx={4} fill="#0F172A" />
        <text
          x={cylX + cylW + 42}
          y={3}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill="#38BDF8"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {fillPct.toFixed(1)}%
        </text>
      </g>
    </svg>
  );
};
