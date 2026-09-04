export type MonetizationStatus = "ON" | "WAITING" | "OFF";

export interface StatusHistory {
  status: MonetizationStatus;
  startDate: number;
  endDate?: number;
}

export interface ApiKeyInfo {
  key: string;
  usageCount: number;
  isExpired: boolean;
  lastResetDate: string; // YYYY-MM-DD
}

export interface AppSettings {
  apiKeys: ApiKeyInfo[];
  lastUsedIndex: number;
  lastCronCompletion?: number;
  dailyScanCount?: number;
  lastScanDate?: string;
  topics?: string[];
}

export interface ViewHistoryEntry {
  viewCount: string;
  videoCount?: string;
  timestamp: number;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  thumbnail: string;
  subscriberCount: string;
  videoCount: string;
  viewCount?: string;
  customUrl?: string;
  status: MonetizationStatus;
  addedAt: number;
  lastVideoPublishedAt?: string;
  topic?: string;
  note?: string;
  notFoundOnYouTube?: boolean;
  history: StatusHistory[];
  viewHistory?: ViewHistoryEntry[];
}
