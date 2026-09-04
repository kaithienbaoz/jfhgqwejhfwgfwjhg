import { ViewHistoryEntry, YouTubeChannel } from "../types";

export interface DailySnapshot {
  dateStr: string; // e.g. "04-09-2026"
  displayDate: string; // e.g. "04/09"
  fullDateLabel: string; // e.g. "04-09-2026"
  timestamp: number;
  closingNote: string; // e.g. "Chốt lúc 24:00" | "Chốt cập nhật ngày hôm sau"
  totalViews: number;
  totalVideos: number;
  dailyGrowthViews: number;
  dailyNewVideos: number;
  isAverage?: boolean;
}

// Format timestamp to DD-MM-YYYY
export const formatDateKey = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
};

// Format short date DD/MM
export const formatShortDate = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
};

/**
 * Xử lý dữ liệu chốt theo ngày:
 * - Số lượng video và số lượng xem sẽ chốt vào 24h ngày hôm đó.
 * - Trường hợp không chốt được lúc 24h thì sẽ chốt vào thời điểm được cập nhật mới nhất của ngày hôm sau.
 */
export function getChannelDailySnapshots(channel: YouTubeChannel): DailySnapshot[] {
  if (!channel.viewHistory || channel.viewHistory.length === 0) {
    // If no history, create a single entry from current stats
    if (channel.viewCount || channel.videoCount) {
      return [{
        dateStr: formatDateKey(channel.addedAt || Date.now()),
        displayDate: formatShortDate(channel.addedAt || Date.now()),
        fullDateLabel: formatDateKey(channel.addedAt || Date.now()),
        timestamp: channel.addedAt || Date.now(),
        closingNote: "Khởi tạo ban đầu",
        totalViews: parseInt(channel.viewCount || "0") || 0,
        totalVideos: parseInt(channel.videoCount || "0") || 0,
        dailyGrowthViews: 0,
        dailyNewVideos: 0,
        isAverage: false
      }];
    }
    return [];
  }

  const sortedRaw = [...channel.viewHistory].sort((a, b) => a.timestamp - b.timestamp);

  // Group raw entries by date
  const byDateMap = new Map<string, ViewHistoryEntry[]>();
  sortedRaw.forEach(entry => {
    const key = formatDateKey(entry.timestamp);
    const list = byDateMap.get(key) || [];
    list.push(entry);
    byDateMap.set(key, list);
  });

  const uniqueDates = Array.from(byDateMap.keys());
  
  // Build daily snapshots with the closing rule
  const dailyList: {
    dateStr: string;
    timestamp: number;
    closingNote: string;
    totalViews: number;
    totalVideos: number;
  }[] = [];

  for (let i = 0; i < uniqueDates.length; i++) {
    const dStr = uniqueDates[i];
    const entries = byDateMap.get(dStr) || [];
    
    // Check if there is an entry on this day
    if (entries.length > 0) {
      // Find the last entry of the day (closest to 24:00)
      const lastEntry = entries[entries.length - 1];
      const dateObj = new Date(lastEntry.timestamp);
      const hours = dateObj.getHours();
      const minutes = dateObj.getMinutes();
      
      let note = `Chốt lúc ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      if (hours === 23 || hours === 0) {
        note = "Chốt lúc 24:00";
      }

      dailyList.push({
        dateStr: dStr,
        timestamp: lastEntry.timestamp,
        closingNote: note,
        totalViews: parseInt(lastEntry.viewCount || "0") || 0,
        totalVideos: parseInt(lastEntry.videoCount || "0") || 0,
      });
    }
  }

  // Calculate daily differences and automatically fill in missing gap days
  const result: DailySnapshot[] = [];

  for (let i = 0; i < dailyList.length; i++) {
    const curr = dailyList[i];

    if (i === 0) {
      result.push({
        dateStr: curr.dateStr,
        displayDate: formatShortDate(curr.timestamp),
        fullDateLabel: curr.dateStr,
        timestamp: curr.timestamp,
        closingNote: curr.closingNote,
        totalViews: curr.totalViews,
        totalVideos: curr.totalVideos,
        dailyGrowthViews: 0,
        dailyNewVideos: 0,
        isAverage: false
      });
      continue;
    }

    const prev = dailyList[i - 1];
    const msPerDay = 24 * 60 * 60 * 1000;
    const dCurr = new Date(curr.timestamp);
    const dPrev = new Date(prev.timestamp);
    dCurr.setHours(0, 0, 0, 0);
    dPrev.setHours(0, 0, 0, 0);
    const daysDiff = Math.max(1, Math.round(Math.abs(dCurr.getTime() - dPrev.getTime()) / msPerDay));

    const totalViewsDiff = curr.totalViews - prev.totalViews;
    const totalVideosDiff = curr.totalVideos - prev.totalVideos;

    if (daysDiff > 1) {
      // Có ngày bị gián đoạn do người dùng không mở máy
      // Tự động phân bổ đều và bù đầy đủ từng ngày vào bảng Excel
      const avgViewsPerDay = Math.round(totalViewsDiff / daysDiff);
      const avgVideosPerDay = Math.max(0, Math.floor(totalVideosDiff / daysDiff));

      for (let dayStep = 1; dayStep < daysDiff; dayStep++) {
        const intermediateDate = new Date(dPrev.getTime() + dayStep * msPerDay);
        const interpViews = prev.totalViews + (avgViewsPerDay * dayStep);
        const interpVideos = prev.totalVideos + (avgVideosPerDay * dayStep);
        const intermediateDateStr = formatDateKey(intermediateDate.getTime());

        result.push({
          dateStr: intermediateDateStr,
          displayDate: formatShortDate(intermediateDate.getTime()),
          fullDateLabel: intermediateDateStr,
          timestamp: intermediateDate.getTime(),
          closingNote: "Ước tính TB (ngày không mở máy)",
          totalViews: interpViews,
          totalVideos: interpVideos,
          dailyGrowthViews: avgViewsPerDay,
          dailyNewVideos: avgVideosPerDay,
          isAverage: true
        });
      }

      // Ngày hiện tại
      result.push({
        dateStr: curr.dateStr,
        displayDate: formatShortDate(curr.timestamp),
        fullDateLabel: curr.dateStr,
        timestamp: curr.timestamp,
        closingNote: curr.closingNote,
        totalViews: curr.totalViews,
        totalVideos: curr.totalVideos,
        dailyGrowthViews: avgViewsPerDay,
        dailyNewVideos: avgVideosPerDay,
        isAverage: true
      });
    } else {
      result.push({
        dateStr: curr.dateStr,
        displayDate: formatShortDate(curr.timestamp),
        fullDateLabel: curr.dateStr,
        timestamp: curr.timestamp,
        closingNote: curr.closingNote,
        totalViews: curr.totalViews,
        totalVideos: curr.totalVideos,
        dailyGrowthViews: totalViewsDiff,
        dailyNewVideos: Math.max(0, totalVideosDiff),
        isAverage: false
      });
    }
  }

  return result;
}
