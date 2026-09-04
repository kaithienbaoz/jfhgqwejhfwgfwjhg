import React, { useState, useMemo } from "react";
import { motion } from "motion/react";
import { X, Film, Table, BarChart2 } from "lucide-react";
import { YouTubeChannel } from "../types";
import { getChannelDailySnapshots } from "../lib/dailyStats";
import { GrowthChart, ChartDataPoint } from "./GrowthChart";

interface VideoHistoryModalProps {
  channel: YouTubeChannel;
  avgVideosInfo: { text: string; sub: string; value: number };
  onClose: () => void;
  formatFullNumber: (numStr: string) => string;
}

export const VideoHistoryModal: React.FC<VideoHistoryModalProps> = ({
  channel,
  avgVideosInfo,
  onClose,
  formatFullNumber
}) => {
  const [chartMode, setChartMode] = useState<"DAILY" | "TOTAL">("DAILY");

  // Daily snapshots processed according to the 24:00 rule
  const dailySnapshots = useMemo(() => {
    return getChannelDailySnapshots(channel);
  }, [channel]);

  // Format short number for chart labels
  const formatShortValue = (val: number, isDaily: boolean): string => {
    if (isDaily) {
      return val > 0 ? `+${val}` : `${val}`;
    }
    return `${val}`;
  };

  // Chart data points
  const chartData: ChartDataPoint[] = useMemo(() => {
    if (dailySnapshots.length === 0) return [];

    return dailySnapshots.map((snap, idx) => {
      const isDaily = chartMode === "DAILY";
      const value = isDaily ? (idx === 0 ? 0 : snap.dailyNewVideos) : snap.totalVideos;
      const formattedValue = formatShortValue(value, isDaily);

      return {
        label: snap.displayDate,
        fullDate: snap.fullDateLabel,
        value,
        formattedValue,
        closingNote: snap.closingNote,
        subText: `Tổng video: ${snap.totalVideos} video`
      };
    });
  }, [dailySnapshots, chartMode]);

  // Calculate total new videos produced in the recorded period
  const totalNewVideos = useMemo(() => {
    if (dailySnapshots.length <= 1) return 0;
    const earliest = dailySnapshots[0];
    const latest = dailySnapshots[dailySnapshots.length - 1];
    return Math.max(0, latest.totalVideos - earliest.totalVideos);
  }, [dailySnapshots]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-6xl bg-[#090D18] border border-slate-800 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="bg-[#0E1528] border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold text-sm">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">{channel.title}</h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800/40 text-rose-300 font-mono">
                  {formatFullNumber(channel.videoCount || "0")} video
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono">
                  TB: {avgVideosInfo.text} vid/ngày
                </span>
              </div>
              <p className="text-[10.5px] text-slate-400 font-mono">
                Báo cáo số lượng video & Biểu đồ số video các ngày &bull; Chốt 24h mỗi ngày
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Split into Excel Table & Chart */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left side: Excel Table */}
            <div className="lg:col-span-6 flex flex-col bg-[#070B14] border border-slate-800/90 rounded-2xl overflow-hidden shadow-inner">
              <div className="bg-[#0C1324] border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Table className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">
                    BẢNG EXCEL THỐNG KÊ SỐ LƯỢNG VIDEO
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {dailySnapshots.length} mốc chốt
                </span>
              </div>

              <div className="overflow-x-auto max-h-[360px] custom-scrollbar">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#0C1324] shadow-sm">
                    <tr className="border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="px-3 py-2.5 border-r border-slate-800/80 w-10 text-center">#</th>
                      <th className="px-4 py-2.5 border-r border-slate-800/80">Ngày tháng</th>
                      <th className="px-4 py-2.5 border-r border-slate-800/80">Tổng số video</th>
                      <th className="px-4 py-2.5 text-rose-400">Video trong ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 font-mono">
                    {dailySnapshots.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500 font-sans">
                          Chưa có dữ liệu lịch sử video.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {[...dailySnapshots].reverse().map((snap, idx) => {
                          const originalIdx = dailySnapshots.length - 1 - idx;
                          let videoDiffText = "-";
                          let videoDiffColor = "text-slate-500";

                          if (originalIdx > 0) {
                            if (snap.dailyNewVideos > 0) {
                              videoDiffText = `+${snap.dailyNewVideos} video`;
                              videoDiffColor = "text-rose-400 font-bold";
                            } else {
                              videoDiffText = "0 video";
                              videoDiffColor = "text-slate-400";
                            }

                            if (snap.isAverage) {
                              videoDiffText += " (TB)";
                            }
                          }

                          return (
                            <tr key={snap.dateStr} className="hover:bg-slate-900/60 transition-colors">
                              <td className="px-3 py-2 border-r border-slate-800/80 text-center text-slate-500 text-[11px]">
                                {originalIdx + 1}
                              </td>
                              <td className="px-4 py-2 border-r border-slate-800/80 text-slate-300 font-sans">
                                <div>
                                  <span className="font-medium">{snap.fullDateLabel}</span>
                                  <span className="block text-[9px] text-slate-500 font-mono">
                                    {snap.closingNote}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-2 border-r border-slate-800/80 text-white font-bold">
                                {formatFullNumber(snap.totalVideos.toString())}
                              </td>
                              <td className={`px-4 py-2 ${videoDiffColor}`}>
                                {videoDiffText}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Summary Rows */}
                        <tr className="bg-[#0E1528] font-bold border-t border-slate-700">
                          <td colSpan={3} className="px-4 py-2.5 border-r border-slate-800 text-[10.5px] uppercase tracking-wider text-right text-slate-400 font-sans">
                            TỔNG VIDEO RA MỚI:
                          </td>
                          <td className="px-4 py-2.5 text-rose-400 font-bold">
                            +{totalNewVideos} video
                          </td>
                        </tr>
                        <tr className="bg-[#0A1020] font-bold border-t border-slate-800">
                          <td colSpan={3} className="px-4 py-2 border-r border-slate-800 text-[10.5px] uppercase tracking-wider text-right text-slate-400 font-sans">
                            TRUNG BÌNH 7 NGÀY GẦN NHẤT:
                          </td>
                          <td className="px-4 py-2 text-amber-400 font-bold">
                            {avgVideosInfo.text} vid/ngày
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right side: Growth Chart for Videos */}
            <div className="lg:col-span-6 flex flex-col gap-2">
              {/* Chart Mode Controls */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-bold">
                  <BarChart2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>BIỂU ĐỒ SỐ VIDEO CÁC NGÀY</span>
                </div>
                <div className="flex items-center gap-1 bg-[#0C1324] border border-slate-800 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setChartMode("DAILY")}
                    className={`px-2.5 py-1 rounded text-[10.5px] font-bold transition-all cursor-pointer ${
                      chartMode === "DAILY"
                        ? "bg-rose-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Video trong ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("TOTAL")}
                    className={`px-2.5 py-1 rounded text-[10.5px] font-bold transition-all cursor-pointer ${
                      chartMode === "TOTAL"
                        ? "bg-rose-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Tổng video
                  </button>
                </div>
              </div>

              {/* Chart render */}
              <GrowthChart
                title={
                  chartMode === "DAILY"
                    ? "BIỂU ĐỒ SỐ VIDEO RA TRONG NGÀY"
                    : "BIỂU ĐỒ TỔNG SỐ LƯỢNG VIDEO THEO NGÀY"
                }
                yAxisLabel={chartMode === "DAILY" ? "Số video trong ngày" : "Tổng số video"}
                xAxisLabel="Ngày"
                data={chartData}
                colorTheme="rose"
                emptyMessage="Cần ít nhất 1-2 mốc dữ liệu ngày để vẽ biểu đồ số video."
              />
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="bg-[#0C1324] border-t border-slate-800 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 gap-2">
          <span>
            Tổng số video hiện tại: <strong className="text-white">{formatFullNumber(channel.videoCount || "0")} video</strong>
          </span>
          <span className="text-rose-400 font-medium">
            Tự động chốt vào 24h &bull; Cập nhật ngày hôm sau nếu lỡ mốc
          </span>
        </div>
      </motion.div>
    </div>
  );
};
