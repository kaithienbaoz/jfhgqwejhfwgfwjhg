import React, { useState } from "react";

export interface ChartDataPoint {
  label: string; // e.g. "04/09"
  fullDate?: string; // e.g. "04-09-2026"
  value: number;
  formattedValue: string; // e.g. "+1.2K" or "12 video"
  closingNote?: string;
  subText?: string;
}

interface GrowthChartProps {
  title: string;
  yAxisLabel: string;
  xAxisLabel?: string;
  data: ChartDataPoint[];
  colorTheme?: "emerald" | "rose" | "cyan" | "amber";
  emptyMessage?: string;
}

export const GrowthChart: React.FC<GrowthChartProps> = ({
  title,
  yAxisLabel,
  xAxisLabel = "Ngày",
  data,
  colorTheme = "emerald",
  emptyMessage = "Chưa có đủ dữ liệu theo ngày để hiển thị biểu đồ."
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-6 text-center border border-dashed border-slate-800 rounded-xl bg-[#080C18]">
        <p className="text-xs text-slate-500">{emptyMessage}</p>
        <span className="text-[10px] text-slate-600 mt-1">Dữ liệu sẽ tự động được vẽ khi hệ thống chốt số liệu theo ngày.</span>
      </div>
    );
  }

  // Theme colors
  const themes = {
    emerald: {
      line: "#10B981",
      point: "#34D399",
      pointBorder: "#064E3B",
      glow: "rgba(16, 185, 129, 0.25)",
      text: "#A7F3D0",
      accent: "text-emerald-400",
      border: "border-emerald-500/30",
      bgHover: "bg-emerald-950/80"
    },
    rose: {
      line: "#F43F5E",
      point: "#FB7185",
      pointBorder: "#881337",
      glow: "rgba(244, 63, 94, 0.25)",
      text: "#FECDD3",
      accent: "text-rose-400",
      border: "border-rose-500/30",
      bgHover: "bg-rose-950/80"
    },
    cyan: {
      line: "#06B6D4",
      point: "#22D3EE",
      pointBorder: "#164E63",
      glow: "rgba(6, 182, 212, 0.25)",
      text: "#CFFAFE",
      accent: "text-cyan-400",
      border: "border-cyan-500/30",
      bgHover: "bg-cyan-950/80"
    },
    amber: {
      line: "#F59E0B",
      point: "#FBBF24",
      pointBorder: "#78350F",
      glow: "rgba(245, 158, 11, 0.25)",
      text: "#FDE68A",
      accent: "text-amber-400",
      border: "border-amber-500/30",
      bgHover: "bg-amber-950/80"
    }
  };

  const theme = themes[colorTheme] || themes.emerald;

  // Chart dimensions
  const width = 520;
  const height = 280;
  const paddingLeft = 55;
  const paddingRight = 45;
  const paddingTop = 50;
  const paddingBottom = 45;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const values = data.map((d) => d.value);
  const minVal = Math.min(0, ...values);
  const maxRaw = Math.max(...values);
  const maxVal = maxRaw <= 0 ? 10 : maxRaw * 1.15; // Provide headroom for value labels
  const range = maxVal - minVal || 1;

  // Calculate coordinates for each point
  const points = data.map((d, index) => {
    const x =
      data.length === 1
        ? paddingLeft + chartWidth / 2
        : paddingLeft + (index / (data.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((d.value - minVal) / range) * chartHeight;
    return { ...d, x, y };
  });

  // Generate SVG path line
  const pathD = points.reduce((acc, curr, idx) => {
    return idx === 0 ? `M ${curr.x} ${curr.y}` : `${acc} L ${curr.x} ${curr.y}`;
  }, "");

  // Y-axis ticks (4 ticks)
  const yTicks = [0, 0.33, 0.66, 1].map((pct) => {
    const val = minVal + pct * range;
    const y = paddingTop + chartHeight - pct * chartHeight;
    let label = Math.round(val).toString();
    if (Math.abs(val) >= 1000000) {
      label = (val / 1000000).toFixed(1) + "M";
    } else if (Math.abs(val) >= 1000) {
      label = (val / 1000).toFixed(1) + "K";
    }
    return { val, y, label };
  });

  const axisY = paddingTop + chartHeight;
  const axisXStart = paddingLeft;
  const axisXEnd = width - paddingRight + 20;
  const axisYTop = paddingTop - 22;

  return (
    <div className="w-full bg-[#080D1A] border border-slate-800 rounded-2xl p-4 flex flex-col relative overflow-hidden shadow-lg">
      {/* Title */}
      <div className="text-center mb-1">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider font-sans">
          {title}
        </h4>
      </div>

      {/* SVG Chart */}
      <div className="relative w-full aspect-[520/280] max-h-[320px]">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full select-none overflow-visible"
        >
          <defs>
            {/* Arrowhead marker for Y-axis (pointing UP) */}
            <marker
              id={`arrow-up-${colorTheme}`}
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 10 L 5 0 L 10 10 z" fill="#94A3B8" />
            </marker>

            {/* Arrowhead marker for X-axis (pointing RIGHT) */}
            <marker
              id={`arrow-right-${colorTheme}`}
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
            </marker>
          </defs>

          {/* Grid lines & Y tick marks */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={axisXStart}
                y1={t.y}
                x2={axisXEnd - 10}
                y2={t.y}
                stroke="#1E293B"
                strokeDasharray="2 4"
                strokeWidth="1"
              />
              <line
                x1={axisXStart - 4}
                y1={t.y}
                x2={axisXStart}
                y2={t.y}
                stroke="#64748B"
                strokeWidth="1.5"
              />
              <text
                x={axisXStart - 8}
                y={t.y + 3.5}
                textAnchor="end"
                fill="#64748B"
                fontSize="9"
                fontFamily="monospace"
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* Vertical dashed lines (gióng từ điểm xuống trục hoành theo mẫu) */}
          {points.map((p, i) => (
            <g key={`dashed-${i}`}>
              <line
                x1={p.x}
                y1={p.y}
                x2={p.x}
                y2={axisY}
                stroke="#334155"
                strokeDasharray="3 3"
                strokeWidth="1.2"
                opacity={hoveredIdx === i ? 1 : 0.65}
              />
              {/* Tick on X axis */}
              <line
                x1={p.x}
                y1={axisY}
                x2={p.x}
                y2={axisY + 4}
                stroke="#64748B"
                strokeWidth="1.5"
              />
              {/* X label */}
              <text
                x={p.x}
                y={axisY + 16}
                textAnchor="middle"
                fill={hoveredIdx === i ? "#F8FAFC" : "#94A3B8"}
                fontSize="9"
                fontWeight={hoveredIdx === i ? "bold" : "normal"}
                fontFamily="sans-serif"
              >
                {p.label}
              </text>
            </g>
          ))}

          {/* Main Axes */}
          {/* Y Axis Line with top arrow */}
          <line
            x1={axisXStart}
            y1={axisY}
            x2={axisXStart}
            y2={axisYTop}
            stroke="#94A3B8"
            strokeWidth="1.75"
            markerEnd={`url(#arrow-up-${colorTheme})`}
          />

          {/* X Axis Line with right arrow */}
          <line
            x1={axisXStart}
            y1={axisY}
            x2={axisXEnd}
            y2={axisY}
            stroke="#94A3B8"
            strokeWidth="1.75"
            markerEnd={`url(#arrow-right-${colorTheme})`}
          />

          {/* Y Axis Label at top */}
          <text
            x={axisXStart - 4}
            y={axisYTop - 8}
            textAnchor="start"
            fill="#CBD5E1"
            fontSize="9.5"
            fontWeight="bold"
            fontFamily="sans-serif"
          >
            {yAxisLabel}
          </text>

          {/* X Axis Label at bottom-right */}
          <text
            x={axisXEnd + 4}
            y={axisY + 14}
            textAnchor="start"
            fill="#CBD5E1"
            fontSize="9.5"
            fontStyle="italic"
            fontWeight="bold"
            fontFamily="sans-serif"
          >
            {xAxisLabel}
          </text>

          {/* Growth Line */}
          <path
            d={pathD}
            fill="none"
            stroke={theme.line}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Nodes / Markers & Value Labels */}
          {points.map((p, i) => (
            <g
              key={`node-${i}`}
              className="cursor-pointer group"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Invisible touch/hover target */}
              <circle cx={p.x} cy={p.y} r="14" fill="transparent" />

              {/* Point Marker */}
              <rect
                x={p.x - 4.5}
                y={p.y - 4.5}
                width="9"
                height="9"
                rx="2"
                fill={theme.point}
                stroke="#070B14"
                strokeWidth="2"
                className="transition-transform duration-150"
                style={{
                  transformOrigin: `${p.x}px ${p.y}px`,
                  transform: hoveredIdx === i ? "scale(1.4)" : "scale(1)"
                }}
              />

              {/* Value Label on top of node */}
              <text
                x={p.x}
                y={p.y - 9}
                textAnchor="middle"
                fill={hoveredIdx === i ? "#FFFFFF" : theme.text}
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              >
                {p.formattedValue}
              </text>
            </g>
          ))}
        </svg>

        {/* Floating Tooltip when hovering over a node */}
        {hoveredIdx !== null && points[hoveredIdx] && (
          <div
            className={`absolute z-20 pointer-events-none transform -translate-x-1/2 bottom-3 left-1/2 sm:left-auto sm:translate-x-0 ${theme.bgHover} border ${theme.border} rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md text-center sm:text-left transition-all`}
          >
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <span className="text-[11px] font-bold text-white">
                {points[hoveredIdx].fullDate || points[hoveredIdx].label}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {points[hoveredIdx].closingNote}
              </span>
            </div>
            <div className={`text-xs font-bold font-mono mt-0.5 ${theme.accent}`}>
              {yAxisLabel}: {points[hoveredIdx].formattedValue}
            </div>
            {points[hoveredIdx].subText && (
              <div className="text-[10px] text-slate-400 mt-0.5">
                {points[hoveredIdx].subText}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10.5px] text-slate-500 font-mono px-1">
        <span>* Chốt vào 24:00 hàng ngày (hoặc cập nhật mới nhất ngày hôm sau)</span>
        <span className="hidden sm:inline">Di chuột vào điểm để xem chi tiết</span>
      </div>
    </div>
  );
};
