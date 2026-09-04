import { useState, useEffect, useMemo, useRef } from "react";
import { 
  Plus, 
  Youtube, 
  Trash2, 
  ExternalLink, 
  Loader2, 
  Search, 
  Settings, 
  Check, 
  AlertCircle, 
  Eye, 
  RotateCw, 
  ArrowUpDown, 
  ChevronDown,
  ChevronUp,
  Pencil, 
  X,
  FolderPlus,
  HelpCircle,
  Lock,
  ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import axios from "axios";
import { cn, formatNumber, formatFullNumber } from "./lib/utils";
import { YouTubeChannel, ApiKeyInfo, AppSettings, ViewHistoryEntry } from "./types";
import { db } from "./lib/firebase";
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, writeBatch } from "firebase/firestore";
import { ViewHistoryModal } from "./components/ViewHistoryModal";
import { VideoHistoryModal } from "./components/VideoHistoryModal";

const DEFAULT_TOPICS = [
  "Bold and the Beautiful",
  "General Hospital",
  "Days of Our Lives",
  "Young and the Restless",
  "Beyond the Gates"
];

export default function App() {
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [topics, setTopics] = useState<string[]>(DEFAULT_TOPICS);
  const [selectedTopic, setSelectedTopic] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Quick Add input (can accept single URL or multiple URLs separated by newlines)
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
  const [quickInputUrl, setQuickInputUrl] = useState("");
  const [quickTopic, setQuickTopic] = useState<string>(DEFAULT_TOPICS[0]);
  const [isAdding, setIsAdding] = useState(false);
  const [addProgress, setAddProgress] = useState<{ current: number; total: number } | null>(null);

  // Settings / API Keys
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [lastKeyIndex, setLastKeyIndex] = useState(-1);
  const [lastCronRun, setLastCronRun] = useState<number | null>(null);
  const [dailyScanCount, setDailyScanCount] = useState<number>(0);
  const [newKeyInput, setNewKeyInput] = useState("");
  const hasAutoRefreshedOnMount = useRef(false);

  // Reset All Data Confirmation & Password
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [resetPasswordInput, setResetPasswordInput] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState("");

  // Manage Topics Modal
  const [isTopicModalOpen, setIsTopicModalOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");

  // Inline Note Editing
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");

  // Delete Confirmation
  const [channelToDelete, setChannelToDelete] = useState<YouTubeChannel | null>(null);

  // View History Modal (Excel-like & Growth Chart)
  const [viewingViewHistory, setViewingViewHistory] = useState<YouTubeChannel | null>(null);

  // Video History Modal (Excel-like & Growth Chart)
  const [viewingVideoHistory, setViewingVideoHistory] = useState<YouTubeChannel | null>(null);

  // General State
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Sorting options: Default to VIEWS_GROWTH_HIGH as requested
  type SortOption = 
    | "VIEWS_GROWTH_HIGH" 
    | "VIEWS_GROWTH_LOW" 
    | "RECENT_VIDEO_NEWEST" 
    | "RECENT_VIDEO_OLDEST" 
    | "AVG_VIDEOS_HIGH" 
    | "AVG_VIDEOS_LOW"
    | "NEWEST";
  const [sortBy, setSortBy] = useState<SortOption>("VIEWS_GROWTH_HIGH");

  // Format date helper (DD-MM-YYYY)
  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
  };

  // Cột 4: View tăng trưởng (Dự đoán view ngày trước, hoặc nếu không có thông tin thì sẽ là view TB)
  const getViewGrowth = (channel: YouTubeChannel) => {
    if (!channel.viewHistory || channel.viewHistory.length === 0) {
      return { value: 0, text: "-", sub: "", color: "text-zinc-500" };
    }

    const history = [...channel.viewHistory].sort((a, b) => a.timestamp - b.timestamp);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday.getTime());
    const todayStr = formatDate(Date.now());

    // Check yesterday's recorded snapshot
    const yesterdayEntry = [...history].reverse().find(h => formatDate(h.timestamp) === yesterdayStr);
    if (yesterdayEntry) {
      const lastBeforeYesterday = [...history].reverse().find(h => {
        const dStr = formatDate(h.timestamp);
        return dStr !== yesterdayStr && dStr !== todayStr;
      });

      if (lastBeforeYesterday) {
        const diff = parseInt(yesterdayEntry.viewCount) - parseInt(lastBeforeYesterday.viewCount);
        if (!isNaN(diff) && diff > 0) {
          return {
            value: diff,
            text: `+${formatFullNumber(diff.toString())}`,
            sub: "Hôm qua",
            color: "text-emerald-400 font-semibold"
          };
        }
      }
    }

    // Fallback: Calculate average daily view growth from all available history
    if (history.length >= 2) {
      const earliest = history[0];
      const latest = history[history.length - 1];
      const d1 = new Date(earliest.timestamp);
      const d2 = new Date(latest.timestamp);
      d1.setHours(0, 0, 0, 0);
      d2.setHours(0, 0, 0, 0);
      const daysDiff = Math.max(1, Math.round(Math.abs(d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000)));

      const diff = parseInt(latest.viewCount) - parseInt(earliest.viewCount);
      if (!isNaN(diff)) {
        const avg = Math.round(diff / daysDiff);
        if (avg > 0) {
          return {
            value: avg,
            text: `+${formatFullNumber(avg.toString())}`,
            sub: "TB/ngày",
            color: "text-emerald-400 font-semibold"
          };
        } else if (avg < 0) {
          return {
            value: avg,
            text: `${formatFullNumber(avg.toString())}`,
            sub: "TB/ngày",
            color: "text-rose-400 font-semibold"
          };
        }
      }
    }

    return { value: 0, text: "0", sub: "TB/ngày", color: "text-zinc-500 font-normal" };
  };

  // Cột 5: Thời gian up video gần nhất
  const getLastVideoInfo = (publishedAt?: string) => {
    if (!publishedAt) {
      return { text: "Chưa có", sub: "", color: "text-zinc-500", timestamp: 0 };
    }
    const publishedDate = new Date(publishedAt);
    if (isNaN(publishedDate.getTime())) {
      return { text: "Không hợp lệ", sub: "", color: "text-zinc-500", timestamp: 0 };
    }

    const now = new Date();
    const diffMs = now.getTime() - publishedDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    let text = "";
    let color = "text-emerald-400";

    if (diffHours < 1) {
      text = "Vừa xong";
    } else if (diffHours < 24) {
      text = `${diffHours} giờ trước`;
    } else if (diffDays < 14) {
      text = `${diffDays} ngày trước`;
      color = "text-amber-400";
    } else {
      text = `${diffDays} ngày trước`;
      color = "text-rose-400";
    }

    const exactDate = `${publishedDate.getHours().toString().padStart(2, '0')}:${publishedDate.getMinutes().toString().padStart(2, '0')} ${publishedDate.getDate().toString().padStart(2, '0')}/${(publishedDate.getMonth() + 1).toString().padStart(2, '0')}/${publishedDate.getFullYear()}`;

    return { text, sub: exactDate, color, timestamp: publishedDate.getTime() };
  };

  // Cột 6: Số video TB 1 ngày làm được (xem video 7 ngày, không tính ngày hiện tại, rồi chia cho 7)
  const getAvgVideos7Days = (channel: YouTubeChannel) => {
    if (!channel.viewHistory || channel.viewHistory.length === 0) {
      return { value: 0, text: "-", sub: "" };
    }

    const history = [...channel.viewHistory].sort((a, b) => a.timestamp - b.timestamp);
    const todayStr = formatDate(Date.now());

    // Exclude today
    const entriesBeforeToday = history.filter(h => formatDate(h.timestamp) !== todayStr && h.videoCount !== undefined);
    if (entriesBeforeToday.length === 0) {
      return { value: 0, text: "-", sub: "Chưa có dữ liệu cũ" };
    }

    const lastEntry = entriesBeforeToday[entriesBeforeToday.length - 1];
    const lastCount = parseInt(lastEntry.videoCount || "0");
    if (isNaN(lastCount)) return { value: 0, text: "-", sub: "" };

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sevenDaysAgoMs = now.getTime() - (7 * 24 * 60 * 60 * 1000);

    let startEntry = entriesBeforeToday[0];
    for (let i = entriesBeforeToday.length - 1; i >= 0; i--) {
      if (entriesBeforeToday[i].timestamp <= sevenDaysAgoMs) {
        startEntry = entriesBeforeToday[i];
        break;
      }
    }

    const startCount = parseInt(startEntry.videoCount || "0");
    if (isNaN(startCount)) return { value: 0, text: "-", sub: "" };

    const diff = lastCount - startCount;
    if (diff < 0) return { value: 0, text: "0.0", sub: "0 v/7 ngày" };

    const msSpan = Math.abs(lastEntry.timestamp - startEntry.timestamp);
    const daysSpan = Math.max(1, Math.round(msSpan / (24 * 60 * 60 * 1000)));
    const divisor = Math.min(7, Math.max(1, daysSpan));
    const avg = diff / divisor;

    return {
      value: avg,
      text: avg.toFixed(1),
      sub: `${diff} video / ${divisor} ngày`
    };
  };

  // Sync with Firestore
  useEffect(() => {
    // 1. Listen for channels
    const unsubscribeChannels = onSnapshot(collection(db, "channels"), (snapshot) => {
      const docs = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as YouTubeChannel));
      setChannels(docs);
      setIsLoaded(true);

      // Tự động xóa các kênh không tìm thấy/bị xóa hoặc 150 ngày chưa làm video nào
      const now = Date.now();
      docs.forEach(c => {
        if (c.notFoundOnYouTube) {
          console.log(`[Auto-Clean Client] Xóa kênh không tìm thấy: ${c.id} (${c.title})`);
          deleteDoc(doc(db, "channels", c.id)).catch(console.error);
        } else if (c.lastVideoPublishedAt) {
          const days = (now - new Date(c.lastVideoPublishedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (days >= 150) {
            console.log(`[Auto-Clean Client] Xóa kênh >= 150 ngày chưa làm video: ${c.id} (${c.title}) - ${Math.floor(days)} ngày`);
            deleteDoc(doc(db, "channels", c.id)).catch(console.error);
          }
        }
      });
    });

    // 2. Listen for shared API Settings & Topics
    const unsubscribeSettings = onSnapshot(doc(db, "settings", "global"), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as AppSettings;
        if (data.apiKeys) setApiKeys(data.apiKeys);
        if (typeof data.lastUsedIndex === 'number') setLastKeyIndex(data.lastUsedIndex);
        if (data.lastCronCompletion) setLastCronRun(data.lastCronCompletion);
        if (typeof data.dailyScanCount === 'number') {
          const todayStr = formatDate(Date.now());
          if (data.lastScanDate === todayStr) {
            setDailyScanCount(data.dailyScanCount);
          } else {
            setDailyScanCount(data.dailyScanCount || 0);
          }
        }
        if (Array.isArray(data.topics) && data.topics.length > 0) {
          setTopics(data.topics);
        }
      }
    });

    return () => {
      unsubscribeChannels();
      unsubscribeSettings();
    };
  }, []);

  // Compute all available topics including custom ones and ones from existing channels
  const allAvailableTopics = useMemo(() => {
    const set = new Set<string>(topics);
    channels.forEach(c => {
      if (c.topic && c.topic.trim()) {
        set.add(c.topic.trim());
      }
    });
    return Array.from(set);
  }, [topics, channels]);

  // Make sure quickTopic is valid
  useEffect(() => {
    if (!quickTopic && allAvailableTopics.length > 0) {
      setQuickTopic(allAvailableTopics[0]);
    }
  }, [allAvailableTopics, quickTopic]);

  // Active key rotation
  const getActiveKey = () => {
    const available = apiKeys.filter(k => !k.isExpired);
    if (available.length === 0) return null;
    return apiKeys[lastKeyIndex % apiKeys.length]?.key || available[0].key;
  };

  // Add channels (supports multi-line or single URL/handle)
  const handleAddChannels = async () => {
    const rawInput = quickInputUrl.trim();
    if (!rawInput) return;

    const lines = rawInput.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const currentKey = getActiveKey();
    if (!currentKey) {
      setError("Hết hạn mức API hoặc chưa cấu hình API Key. Vui lòng kiểm tra lại trong Cài đặt.");
      return;
    }

    setIsAdding(true);
    setError("");
    setAddProgress({ current: 0, total: lines.length });

    let addedCount = 0;
    let failedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const urlOrHandle = lines[i];
      setAddProgress({ current: i + 1, total: lines.length });

      try {
        const keyToUse = getActiveKey();
        if (!keyToUse) {
          failedLines.push(`${urlOrHandle} (Hết hạn ngạch API)`);
          break;
        }

        const response = await axios.get(`/api/youtube/channel?url=${encodeURIComponent(urlOrHandle)}&key=${keyToUse}`);
        const data = response.data;

        const newChannel: YouTubeChannel = {
          ...data,
          status: "ON",
          topic: quickTopic || allAvailableTopics[0] || "Chung",
          note: "",
          addedAt: Date.now(),
          history: [{
            status: "ON",
            startDate: Date.now()
          }],
          viewHistory: [{
            viewCount: data.viewCount,
            videoCount: data.videoCount,
            timestamp: Date.now()
          }]
        };

        await setDoc(doc(db, "channels", newChannel.id), newChannel);
        addedCount++;
      } catch (err: any) {
        console.error(`Error adding ${urlOrHandle}:`, err.message);
        failedLines.push(urlOrHandle);
      }
    }

    setIsAdding(false);
    setAddProgress(null);

    if (failedLines.length > 0) {
      if (addedCount > 0) {
        setQuickInputUrl(failedLines.join("\n"));
        setError(`Đã thêm ${addedCount} kênh. Còn ${failedLines.length} kênh không tìm thấy hoặc bị lỗi.`);
      } else {
        setError(`Không tìm thấy kênh: ${failedLines.join(", ")}`);
      }
    } else {
      setQuickInputUrl("");
      setIsAddChannelOpen(false);
    }
  };

  // Change topic for a channel
  const updateChannelTopic = async (channelId: string, newTopic: string) => {
    try {
      await updateDoc(doc(db, "channels", channelId), { topic: newTopic });
      setChannels(prev => prev.map(c => c.id === channelId ? { ...c, topic: newTopic } : c));
    } catch (err) {
      console.error("Failed to update channel topic", err);
    }
  };

  // Save inline note
  const saveNote = async (channelId: string, noteVal: string) => {
    setEditingNoteId(null);
    try {
      await updateDoc(doc(db, "channels", channelId), { note: noteVal.trim() });
      setChannels(prev => prev.map(c => c.id === channelId ? { ...c, note: noteVal.trim() } : c));
    } catch (err) {
      console.error("Failed to save note", err);
    }
  };

  // Delete channel
  const confirmDeleteChannel = async () => {
    if (!channelToDelete) return;
    try {
      await deleteDoc(doc(db, "channels", channelToDelete.id));
      setChannels(prev => prev.filter(c => c.id !== channelToDelete.id));
      setChannelToDelete(null);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  // Manage Topics
  const handleAddTopic = async () => {
    const trimmed = newTopicName.trim();
    if (!trimmed) return;
    if (allAvailableTopics.includes(trimmed)) {
      setNewTopicName("");
      setIsTopicModalOpen(false);
      setSelectedTopic(trimmed);
      return;
    }

    const updated = [...topics, trimmed];
    setTopics(updated);
    setNewTopicName("");
    setIsTopicModalOpen(false);
    setSelectedTopic(trimmed);

    try {
      await setDoc(doc(db, "settings", "global"), { topics: updated }, { merge: true });
    } catch (err) {
      console.error("Failed to save new topic", err);
    }
  };

  // Trigger background refresh
  const triggerRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await axios.post("/api/admin/refresh");
    } catch (err) {
      console.error("Refresh failed", err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 2000);
    }
  };

  // Tự động cập nhật mỗi khi người dùng vào phần mềm
  useEffect(() => {
    if (isLoaded && !hasAutoRefreshedOnMount.current) {
      hasAutoRefreshedOnMount.current = true;
      triggerRefresh();
    }
  }, [isLoaded]);

  // Toggle sorting handlers for columns 4, 5, 6
  const handleToggleSortViews = () => {
    if (sortBy === "VIEWS_GROWTH_HIGH") {
      setSortBy("VIEWS_GROWTH_LOW");
    } else {
      setSortBy("VIEWS_GROWTH_HIGH");
    }
  };

  const handleToggleSortLastVideo = () => {
    if (sortBy === "RECENT_VIDEO_NEWEST") {
      setSortBy("RECENT_VIDEO_OLDEST");
    } else {
      setSortBy("RECENT_VIDEO_NEWEST");
    }
  };

  const handleToggleSortAvgVideos = () => {
    if (sortBy === "AVG_VIDEOS_HIGH") {
      setSortBy("AVG_VIDEOS_LOW");
    } else {
      setSortBy("AVG_VIDEOS_HIGH");
    }
  };

  // Reset toàn bộ dữ liệu lưu trữ (view, sub, video, ngày tháng, viewHistory)
  // Giữ nguyên các kênh và đặt lại trạng thái như mới add
  const handleResetAllData = async () => {
    if (resetPasswordInput.trim() !== "270714") {
      setResetPasswordError("Mật khẩu không chính xác! CẢNH BÁO: Nhập sai phần mềm sẽ bị khóa!");
      return;
    }

    setIsResetting(true);
    setResetPasswordError("");

    try {
      const now = Date.now();
      const chunkSize = 450;
      for (let i = 0; i < channels.length; i += chunkSize) {
        const chunk = channels.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach((ch) => {
          const chRef = doc(db, "channels", ch.id);
          batch.update(chRef, {
            viewHistory: [],
            subscriberCount: "0",
            videoCount: "0",
            viewCount: "0",
            lastVideoPublishedAt: null,
            history: [],
            addedAt: now,
            notFoundOnYouTube: false
          });
        });
        await batch.commit();
      }

      // Đặt lại cài đặt quét toàn cục
      await setDoc(doc(db, "settings", "global"), {
        lastCronCompletion: null,
        dailyScanCount: 0
      }, { merge: true });

      setLastCronRun(null);
      setDailyScanCount(0);
      setIsResetConfirmOpen(false);
      setResetPasswordInput("");
      setResetSuccessMessage("Đã xóa toàn bộ dữ liệu lưu trữ thành công! Các kênh đã được đặt lại như mới.");

      setTimeout(() => {
        setResetSuccessMessage("");
      }, 5000);
    } catch (err: any) {
      console.error("Lỗi khi xóa dữ liệu lưu trữ:", err);
      setResetPasswordError(`Có lỗi xảy ra: ${err.message || 'Vui lòng thử lại'}`);
    } finally {
      setIsResetting(false);
    }
  };

  // Filter and sort channels
  const filteredAndSortedChannels = useMemo(() => {
    return channels
      .filter(c => {
        const matchesTopic = selectedTopic === "ALL" || c.topic === selectedTopic;
        const matchesSearch = !searchQuery.trim() || 
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.note && c.note.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (c.customUrl && c.customUrl.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesTopic && matchesSearch;
      })
      .sort((a, b) => {
        // Cột 4: View tăng trưởng
        if (sortBy === "VIEWS_GROWTH_HIGH") {
          const vA = getViewGrowth(a).value;
          const vB = getViewGrowth(b).value;
          if (vB !== vA) return vB - vA;
          return (b.addedAt || 0) - (a.addedAt || 0);
        }
        if (sortBy === "VIEWS_GROWTH_LOW") {
          const vA = getViewGrowth(a).value;
          const vB = getViewGrowth(b).value;
          if (vA !== vB) return vA - vB;
          return (b.addedAt || 0) - (a.addedAt || 0);
        }

        // Cột 5: Video gần nhất (Mới nhất trước <-> Cũ nhất trước)
        if (sortBy === "RECENT_VIDEO_NEWEST") {
          const tA = getLastVideoInfo(a.lastVideoPublishedAt).timestamp;
          const tB = getLastVideoInfo(b.lastVideoPublishedAt).timestamp;
          if (tA === 0 && tB === 0) return (b.addedAt || 0) - (a.addedAt || 0);
          if (tA === 0) return 1;
          if (tB === 0) return -1;
          return tB - tA; // Mới nhất lên đầu
        }
        if (sortBy === "RECENT_VIDEO_OLDEST") {
          const tA = getLastVideoInfo(a.lastVideoPublishedAt).timestamp;
          const tB = getLastVideoInfo(b.lastVideoPublishedAt).timestamp;
          if (tA === 0 && tB === 0) return (b.addedAt || 0) - (a.addedAt || 0);
          if (tA === 0) return 1;
          if (tB === 0) return -1;
          return tA - tB; // Cũ nhất lên đầu
        }

        // Cột 6: Video TB/ngày (Nhiều nhất trước <-> Ít nhất trước)
        if (sortBy === "AVG_VIDEOS_HIGH") {
          const aA = getAvgVideos7Days(a).value;
          const aB = getAvgVideos7Days(b).value;
          if (aB !== aA) return aB - aA;
          return (b.addedAt || 0) - (a.addedAt || 0);
        }
        if (sortBy === "AVG_VIDEOS_LOW") {
          const aA = getAvgVideos7Days(a).value;
          const aB = getAvgVideos7Days(b).value;
          if (aA !== aB) return aA - aB;
          return (b.addedAt || 0) - (a.addedAt || 0);
        }

        // Mặc định: Kênh mới thêm nhất
        return (b.addedAt || 0) - (a.addedAt || 0);
      });
  }, [channels, selectedTopic, searchQuery, sortBy]);

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 font-sans selection:bg-rose-500/30 selection:text-rose-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#0A0F1D]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-rose-950/40 flex-shrink-0">
              <Youtube className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  Kênh theo dõi
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-medium">
                    {channels.length}
                  </span>
                </h1>
              </div>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/40 text-emerald-400 font-medium font-mono text-[10.5px]">
                  <span className={cn("w-1.5 h-1.5 rounded-full bg-emerald-400", isRefreshing ? "animate-ping" : "animate-pulse")} />
                  <span>
                    {lastCronRun 
                      ? `Lần quét gần nhất: ${new Date(lastCronRun).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` 
                      : "Chưa quét dữ liệu"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Nút Thêm kênh xuất hiện bên trái Quét lại */}
            <button 
              onClick={() => setIsAddChannelOpen(prev => !prev)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all text-xs font-semibold shadow-sm cursor-pointer",
                isAddChannelOpen 
                  ? "bg-rose-600 border-rose-500 text-white shadow-rose-950/40" 
                  : "bg-rose-600/15 border-rose-500/40 hover:bg-rose-600/25 text-rose-300 hover:text-white"
              )}
              title={isAddChannelOpen ? "Đóng khung thêm kênh" : "Mở khung thêm kênh"}
            >
              <Plus className={cn("w-3.5 h-3.5 transition-transform duration-200", isAddChannelOpen && "rotate-45")} />
              <span>{isAddChannelOpen ? "Đóng thêm kênh" : "Thêm kênh"}</span>
            </button>

            {/* Nút Quét lại */}
            <button 
              onClick={triggerRefresh}
              disabled={isRefreshing}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-all text-xs font-medium cursor-pointer",
                isRefreshing && "opacity-70"
              )}
              title="Quét lại dữ liệu tự động"
            >
              <RotateCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin text-rose-400")} />
              <span className="hidden sm:inline">{isRefreshing ? "Đang quét..." : "Quét lại"}</span>
            </button>

            {/* Nút Cài đặt API */}
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-all text-xs font-medium cursor-pointer"
              title="Cài đặt API Key"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cài đặt API</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area - Full width and spacious */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        
        {/* API Key Missing Warning */}
        {apiKeys.length === 0 && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-center justify-between gap-4 text-amber-200">
            <div className="flex items-center gap-3 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>Chưa cấu hình YouTube API Key. Vui lòng bấm vào "Cài đặt API" để thêm key hoạt động.</span>
            </div>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold whitespace-nowrap"
            >
              Thêm Key ngay
            </button>
          </div>
        )}

        {/* TOPIC BAR: 1 Row with "Tất cả" button, topics, and "+ Thêm chủ đề" */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar scroll-smooth">
          {/* Nút Tất cả */}
          <button
            onClick={() => setSelectedTopic("ALL")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 flex-shrink-0",
              selectedTopic === "ALL"
                ? "bg-slate-200 text-slate-900 shadow-sm"
                : "bg-[#0E1528] text-slate-400 hover:text-slate-200 hover:bg-[#151F38] border border-slate-800/80"
            )}
          >
            <span>Tất cả</span>
            <span className={cn(
              "px-1.5 py-0.2 rounded text-[10px] font-mono",
              selectedTopic === "ALL" ? "bg-slate-300 text-slate-900" : "bg-slate-800 text-slate-400"
            )}>
              {channels.length}
            </span>
          </button>

          {/* Dynamic Topics */}
          {allAvailableTopics.map((topic) => {
            const count = channels.filter(c => c.topic === topic).length;
            const isSelected = selectedTopic === topic;
            return (
              <button
                key={topic}
                onClick={() => setSelectedTopic(topic)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 flex-shrink-0 border",
                  isSelected
                    ? "bg-rose-950/40 text-rose-300 border-rose-500/60 shadow-sm shadow-rose-950/30"
                    : "bg-[#0E1528] text-slate-300 hover:text-white hover:bg-[#151F38] border-slate-800/80"
                )}
              >
                <span>{topic}</span>
                <span className={cn(
                  "px-1.5 py-0.2 rounded text-[10px] font-mono",
                  isSelected ? "bg-rose-500/30 text-rose-200" : "bg-slate-800 text-slate-400"
                )}>
                  {count}
                </span>
              </button>
            );
          })}

          {/* Nút Thêm chủ đề */}
          <button
            onClick={() => setIsTopicModalOpen(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 bg-[#0E1528]/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-dashed border-slate-700/80 flex-shrink-0"
            title="Thêm hoặc quản lý chủ đề"
          >
            <FolderPlus className="w-3.5 h-3.5 text-rose-400" />
            <span>+ Thêm chủ đề</span>
          </button>
        </div>

        {/* QUICK ADD CHANNEL BAR (Hiển thị khi bấm "Thêm kênh" ở trên) */}
        <AnimatePresence>
          {isAddChannelOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="bg-[#0D1426] border border-rose-500/40 rounded-xl p-3.5 shadow-xl shadow-black/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                    <Plus className="w-3.5 h-3.5 text-rose-400" />
                    <span>Thêm kênh mới theo chủ đề</span>
                  </div>
                  <button
                    onClick={() => setIsAddChannelOpen(false)}
                    className="p-1 text-slate-400 hover:text-white rounded-md transition-colors text-xs flex items-center gap-1 cursor-pointer"
                    title="Đóng khung thêm kênh"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Đóng</span>
                  </button>
                </div>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Dán URL kênh, @handle hoặc channel ID (UC...) — mỗi dòng một kênh"
                      value={quickInputUrl}
                      onChange={(e) => setQuickInputUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAddChannels();
                        }
                      }}
                      disabled={isAdding}
                      className="w-full bg-[#070B16] border border-slate-700/60 focus:border-rose-500/80 rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={quickTopic}
                      onChange={(e) => setQuickTopic(e.target.value)}
                      disabled={isAdding}
                      className="bg-[#070B16] border border-slate-700/60 focus:border-rose-500/80 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {allAvailableTopics.map(t => (
                        <option key={t} value={t} className="bg-[#0D1426] text-slate-200">
                          {t}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleAddChannels}
                      disabled={isAdding || !quickInputUrl.trim() || apiKeys.length === 0}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap transition-all shadow-md shadow-rose-950/40 disabled:opacity-40 cursor-pointer"
                    >
                      {isAdding ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Đang thêm ({addProgress?.current}/{addProgress?.total})...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>+ Thêm kênh</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Notification */}
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-xl flex items-center justify-between text-xs text-rose-300">
            <span>{error}</span>
            <button onClick={() => setError("")} className="p-1 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Table Controls: Title, Search, Sort */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-wide">
              {selectedTopic === "ALL" ? "Tất cả kênh" : selectedTopic}
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              ({filteredAndSortedChannels.length})
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm kênh, note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0D1426] border border-slate-700/60 focus:border-slate-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")} 
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 bg-[#0D1426] border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent border-none focus:ring-0 text-slate-200 outline-none cursor-pointer text-xs"
              >
                <option value="VIEWS_GROWTH_HIGH" className="bg-[#0D1426]">View tăng trưởng (Cao &darr;)</option>
                <option value="VIEWS_GROWTH_LOW" className="bg-[#0D1426]">View tăng trưởng (Thấp &uarr;)</option>
                <option value="RECENT_VIDEO_NEWEST" className="bg-[#0D1426]">Video gần nhất (Mới &darr;)</option>
                <option value="RECENT_VIDEO_OLDEST" className="bg-[#0D1426]">Video gần nhất (Cũ &uarr;)</option>
                <option value="AVG_VIDEOS_HIGH" className="bg-[#0D1426]">Video TB/ngày (Nhiều &darr;)</option>
                <option value="AVG_VIDEOS_LOW" className="bg-[#0D1426]">Video TB/ngày (Ít &uarr;)</option>
                <option value="NEWEST" className="bg-[#0D1426]">Mới thêm vào hệ thống</option>
              </select>
            </div>
          </div>
        </div>

        {/* 7-COLUMN TABLE */}
        <div className="bg-[#0B1020] border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[950px]">
              <thead>
                <tr className="bg-[#0D152A] border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider select-none">
                  <th className="py-3 px-4 w-[280px]">Kênh</th>
                  <th className="py-3 px-3 w-[180px]">Nhóm chủ đề</th>
                  <th className="py-3 px-3 w-[150px]">Note</th>
                  
                  {/* View tăng trưởng (Clickable Sort Header) */}
                  <th className="py-3 px-3 w-[160px] text-right">
                    <button
                      type="button"
                      onClick={handleToggleSortViews}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors cursor-pointer ml-auto group/sort"
                      title="Click để xếp hạng: Cao nhất dần xuống <-> Ít nhất đến cao nhất"
                    >
                      <span className="group-hover/sort:underline">View tăng trưởng</span>
                      {sortBy === "VIEWS_GROWTH_HIGH" && (
                        <ChevronDown className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy === "VIEWS_GROWTH_LOW" && (
                        <ChevronUp className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy !== "VIEWS_GROWTH_HIGH" && sortBy !== "VIEWS_GROWTH_LOW" && (
                        <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-60 group-hover/sort:opacity-100" />
                      )}
                    </button>
                  </th>

                  {/* Video gần nhất (Clickable Sort Header) */}
                  <th className="py-3 px-3 w-[160px] text-center">
                    <button
                      type="button"
                      onClick={handleToggleSortLastVideo}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors cursor-pointer mx-auto group/sort"
                      title="Click để xếp hạng: Mới nhất đến lâu nhất <-> Cũ nhất đến mới nhất"
                    >
                      <span className="group-hover/sort:underline">Video gần nhất</span>
                      {sortBy === "RECENT_VIDEO_NEWEST" && (
                        <ChevronDown className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy === "RECENT_VIDEO_OLDEST" && (
                        <ChevronUp className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy !== "RECENT_VIDEO_NEWEST" && sortBy !== "RECENT_VIDEO_OLDEST" && (
                        <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-60 group-hover/sort:opacity-100" />
                      )}
                    </button>
                  </th>

                  {/* Video TB/ngày (Clickable Sort Header) */}
                  <th className="py-3 px-3 w-[160px] text-center">
                    <button
                      type="button"
                      onClick={handleToggleSortAvgVideos}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors cursor-pointer mx-auto group/sort"
                      title="Click để xếp hạng: Nhiều nhất đến ít nhất <-> Ít nhất đến nhiều nhất"
                    >
                      <span className="group-hover/sort:underline">Video TB/ngày</span>
                      {sortBy === "AVG_VIDEOS_HIGH" && (
                        <ChevronDown className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy === "AVG_VIDEOS_LOW" && (
                        <ChevronUp className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      )}
                      {sortBy !== "AVG_VIDEOS_HIGH" && sortBy !== "AVG_VIDEOS_LOW" && (
                        <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-60 group-hover/sort:opacity-100" />
                      )}
                    </button>
                  </th>

                  <th className="py-3 px-4 w-[80px] text-center">XÓA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredAndSortedChannels.map((channel) => {
                  const viewGrowth = getViewGrowth(channel);
                  const lastVideo = getLastVideoInfo(channel.lastVideoPublishedAt);
                  const avgVideos = getAvgVideos7Days(channel);
                  const isEditingThisNote = editingNoteId === channel.id;

                  return (
                    <tr 
                      key={channel.id}
                      className="hover:bg-[#111A33]/70 transition-colors group"
                    >
                      {/* Cột 1: Tên kênh */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <a 
                            href={`https://youtube.com/${channel.customUrl || `channel/${channel.id}`}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative group/thumb flex-shrink-0"
                            title="Mở kênh trên YouTube"
                          >
                            <img
                              src={channel.thumbnail}
                              alt={channel.title}
                              className="w-10 h-10 rounded-xl object-cover bg-slate-800 border border-slate-700/60 group-hover/thumb:border-rose-500 transition-all"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                              <ExternalLink className="w-3 h-3 text-white" />
                            </div>
                          </a>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <a
                                href={`https://youtube.com/${channel.customUrl || `channel/${channel.id}`}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-white hover:text-rose-400 transition-colors truncate block text-xs"
                                title={channel.title}
                              >
                                {channel.title}
                              </a>
                            </div>

                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                              <span>{formatNumber(channel.subscriberCount)} subs</span>
                              <span>&bull;</span>
                              <span>{formatNumber(channel.videoCount)} vids</span>
                              <span>&bull;</span>
                              <button
                                onClick={() => setViewingViewHistory(channel)}
                                className="text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-0.5"
                                title="Xem báo cáo lịch sử View (Excel)"
                              >
                                <Eye className="w-3 h-3 inline" />
                                <span>{formatNumber(channel.viewCount || "0")} views</span>
                              </button>
                            </div>

                            {channel.notFoundOnYouTube && (
                              <div className="text-[10px] text-amber-400 font-medium mt-0.5 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5 inline" />
                                <span>Kênh không tìm thấy (có thể đã bị xóa/ẩn)</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Cột 2: Nhóm theo chủ đề (Dropdown chọn trực tiếp) */}
                      <td className="py-3 px-3">
                        <select
                          value={channel.topic || allAvailableTopics[0]}
                          onChange={(e) => updateChannelTopic(channel.id, e.target.value)}
                          className="w-full bg-[#0E162B] border border-slate-700/70 hover:border-slate-500 focus:border-rose-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none cursor-pointer transition-colors"
                        >
                          {allAvailableTopics.map(t => (
                            <option key={t} value={t} className="bg-[#0D152A] text-slate-200">
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Cột 3: Note (Có thể sửa thông tin ngắn inline) */}
                      <td className="py-3 px-3">
                        {isEditingThisNote ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              type="text"
                              value={editingNoteValue}
                              onChange={(e) => setEditingNoteValue(e.target.value)}
                              onBlur={() => saveNote(channel.id, editingNoteValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveNote(channel.id, editingNoteValue);
                                if (e.key === "Escape") setEditingNoteId(null);
                              }}
                              placeholder="Nhập ghi chú..."
                              className="w-full bg-[#070B16] border border-rose-500/80 rounded px-2 py-1 text-xs text-white focus:outline-none font-medium"
                            />
                            <button 
                              onClick={() => saveNote(channel.id, editingNoteValue)}
                              className="p-1 text-emerald-400 hover:text-emerald-300"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div 
                            onClick={() => {
                              setEditingNoteId(channel.id);
                              setEditingNoteValue(channel.note || "");
                            }}
                            className="group/note flex items-center justify-between gap-1.5 py-1 px-2 rounded hover:bg-[#15203A] cursor-pointer transition-colors text-xs text-slate-300"
                            title="Bấm để sửa ghi chú"
                          >
                            <span className={cn(
                              "truncate block font-medium",
                              !channel.note && "text-slate-500 italic"
                            )}>
                              {channel.note || "Thêm note..."}
                            </span>
                            <Pencil className="w-3 h-3 text-slate-500 opacity-0 group-hover/note:opacity-100 group-hover:opacity-60 transition-opacity flex-shrink-0" />
                          </div>
                        )}
                      </td>

                      {/* Cột 4: View tăng trưởng (Click vào để mở bảng Excel lịch sử biến động view từng ngày) */}
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setViewingViewHistory(channel)}
                          className="group/growth flex flex-col items-end w-full py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer transition-all text-right"
                          title="Bấm để xem danh sách tăng trưởng view từng ngày theo dạng Excel"
                        >
                          <span className={cn(
                            "text-xs font-bold transition-all group-hover/growth:underline group-hover/growth:scale-105",
                            viewGrowth.color
                          )}>
                            {viewGrowth.text}
                          </span>
                          {viewGrowth.sub && (
                            <span className="text-[10px] text-slate-400 font-medium">
                              {viewGrowth.sub}
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Cột 5: Thời gian up video gần nhất */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className={cn("text-xs font-semibold", lastVideo.color)}>
                            {lastVideo.text}
                          </span>
                          {lastVideo.sub && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {lastVideo.sub}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cột 6: Số video TB 1 ngày làm được (Click để xem thống kê Excel & biểu đồ số video các ngày) */}
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setViewingVideoHistory(channel)}
                          className="group/avgvid flex flex-col items-center mx-auto py-1 px-2 rounded-lg hover:bg-slate-800/60 cursor-pointer transition-all text-center"
                          title="Bấm để xem bảng Excel thống kê số lượng video & biểu đồ số video các ngày"
                        >
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-bold font-mono transition-all group-hover/avgvid:scale-105 group-hover/avgvid:underline",
                            avgVideos.value > 0 
                              ? "bg-rose-950/50 text-rose-300 border border-rose-800/40" 
                              : "text-slate-400"
                          )}>
                            {avgVideos.text} {avgVideos.value > 0 ? "vid/ngày" : ""}
                          </span>
                          {avgVideos.sub && (
                            <span className="text-[9px] text-slate-500 mt-0.5 group-hover/avgvid:text-rose-400/80">
                              {avgVideos.sub}
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Xóa */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => setChannelToDelete(channel)}
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-[11px] font-bold tracking-wider uppercase transition-all shadow-sm shadow-red-950/50 cursor-pointer inline-flex items-center justify-center"
                          title="Xóa kênh khỏi danh sách theo dõi"
                        >
                          XÓA
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredAndSortedChannels.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Search className="w-6 h-6 text-slate-600" />
                        <p className="text-xs font-semibold uppercase tracking-wider">Không tìm thấy kênh nào</p>
                        <p className="text-[11px] text-slate-500">
                          {searchQuery ? "Thử tìm kiếm với từ khóa khác" : "Dán link kênh ở thanh trên để thêm kênh mới vào nhóm này"}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL: Thêm / Quản lý chủ đề */}
      <AnimatePresence>
        {isTopicModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTopicModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-[#0D152A] border border-slate-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-rose-500" />
                  <h3 className="text-sm font-bold text-white">Thêm chủ đề mới</h3>
                </div>
                <button 
                  onClick={() => setIsTopicModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5 font-medium">Tên chủ đề:</label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Ví dụ: Drama TV, Phim Mỹ..."
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTopic()}
                    className="w-full bg-[#070B16] border border-slate-700 focus:border-rose-500 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-2 font-medium">
                    Các chủ đề hiện có ({allAvailableTopics.length}):
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto custom-scrollbar p-1">
                    {allAvailableTopics.map(t => (
                      <span key={t} className="px-2.5 py-1 rounded-md bg-slate-800/80 text-slate-300 text-xs border border-slate-700/60">
                        {t} ({channels.filter(c => c.topic === t).length})
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                  <button
                    onClick={() => setIsTopicModalOpen(false)}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleAddTopic}
                    disabled={!newTopicName.trim()}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                  >
                    Lưu chủ đề
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Xác nhận xóa kênh */}
      <AnimatePresence>
        {channelToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChannelToDelete(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-[#0D152A] border border-slate-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 text-rose-400 mb-3">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-sm font-bold text-white">Xác nhận xóa kênh</h3>
              </div>

              <div className="flex items-center gap-3 p-3 bg-slate-900/80 rounded-xl border border-slate-800 mb-4">
                <img 
                  src={channelToDelete.thumbnail} 
                  alt="" 
                  className="w-10 h-10 rounded-lg object-cover" 
                  referrerPolicy="no-referrer" 
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{channelToDelete.title}</p>
                  <p className="text-[10px] text-slate-400">Chủ đề: {channelToDelete.topic || "Chưa phân nhóm"}</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-6">
                Bạn có chắc chắn muốn xóa kênh này khỏi hệ thống theo dõi? Dữ liệu lịch sử của kênh này sẽ bị gỡ bỏ.
              </p>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setChannelToDelete(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={confirmDeleteChannel}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md transition-colors"
                >
                  Xóa kênh
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Báo cáo Lịch sử View (Bảng Excel + Biểu đồ đường tăng trưởng) */}
      <AnimatePresence>
        {viewingViewHistory && (
          <ViewHistoryModal
            channel={viewingViewHistory}
            onClose={() => setViewingViewHistory(null)}
            formatFullNumber={formatFullNumber}
          />
        )}
      </AnimatePresence>

      {/* MODAL: Báo cáo Thống kê Video (Bảng Excel + Biểu đồ số video các ngày) */}
      <AnimatePresence>
        {viewingVideoHistory && (
          <VideoHistoryModal
            channel={viewingVideoHistory}
            avgVideosInfo={getAvgVideos7Days(viewingVideoHistory)}
            onClose={() => setViewingVideoHistory(null)}
            formatFullNumber={formatFullNumber}
          />
        )}
      </AnimatePresence>

      {/* MODAL: Settings / API Key Rotation */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-[#0D152A] border border-slate-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                    <Settings className="w-4 h-4 text-slate-300" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cài đặt YouTube API Key</h3>
                    <p className="text-[10px] text-slate-400">Hệ thống xoay vòng Key tự động khi quét dữ liệu</p>
                  </div>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-1 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1 font-medium">Thêm API Key mới:</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={newKeyInput}
                      onChange={(e) => setNewKeyInput(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && newKeyInput.trim()) {
                          const newKeyInfo: ApiKeyInfo = {
                            key: newKeyInput.trim(),
                            usageCount: 0,
                            isExpired: false,
                            lastResetDate: formatDate(Date.now())
                          };
                          const updated = [...apiKeys, newKeyInfo];
                          setApiKeys(updated);
                          setNewKeyInput("");
                          await setDoc(doc(db, "settings", "global"), { apiKeys: updated }, { merge: true });
                        }
                      }}
                      className="flex-1 bg-[#070B16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-rose-500 focus:outline-none"
                    />
                    <button
                      onClick={async () => {
                        if (!newKeyInput.trim()) return;
                        const newKeyInfo: ApiKeyInfo = {
                          key: newKeyInput.trim(),
                          usageCount: 0,
                          isExpired: false,
                          lastResetDate: formatDate(Date.now())
                        };
                        const updated = [...apiKeys, newKeyInfo];
                        setApiKeys(updated);
                        setNewKeyInput("");
                        await setDoc(doc(db, "settings", "global"), { apiKeys: updated }, { merge: true });
                      }}
                      className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 rounded-lg text-white text-xs font-semibold transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-2 font-medium">
                    Danh sách Key đang lưu ({apiKeys.length}):
                  </label>
                  <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {apiKeys.map((k, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "bg-[#070B16] border rounded-xl p-3 flex flex-col gap-1.5",
                          idx === lastKeyIndex ? "border-rose-500/60" : "border-slate-800"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-slate-300">••••••••{k.key.slice(-8)}</span>
                          <div className="flex items-center gap-2">
                            {idx === lastKeyIndex && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-medium">
                                Active
                              </span>
                            )}
                            <button
                              onClick={async () => {
                                const updated = apiKeys.filter((_, i) => i !== idx);
                                setApiKeys(updated);
                                await setDoc(doc(db, "settings", "global"), { apiKeys: updated }, { merge: true });
                              }}
                              className="p-1 hover:text-rose-400 text-slate-500 transition-colors"
                              title="Xóa Key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const percentUsed = k.isExpired 
                            ? 100 
                            : Math.min(100, Number(((k.usageCount / 10000) * 100).toFixed(k.usageCount > 0 && (k.usageCount / 10000) * 100 < 1 ? 2 : 1)));
                          return (
                            <div className="flex flex-col gap-1.5 mt-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className={cn(
                                  "font-medium",
                                  k.isExpired ? "text-rose-400 font-semibold" : percentUsed >= 90 ? "text-amber-400" : "text-emerald-400"
                                )}>
                                  {k.isExpired ? "Đã dùng: 100% (Hết hạn ngạch)" : `Đã dùng: ${percentUsed}%`}
                                </span>
                                <span className="font-mono text-slate-500 text-[10px]">Reset hàng ngày</span>
                              </div>
                              <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full rounded-full transition-all duration-300",
                                    k.isExpired ? "bg-rose-500" : percentUsed >= 90 ? "bg-amber-500" : "bg-emerald-500"
                                  )}
                                  style={{ width: `${Math.max(k.usageCount > 0 ? 3 : 0, Math.min(100, percentUsed))}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}

                    {apiKeys.length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-4">Chưa có API Key nào được lưu.</p>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                  Mỗi API key YouTube cung cấp 10.000 điểm hạn ngạch/ngày (tương đương 100%). Hệ thống tự động báo % đã dùng và xoay tua key khi quét các kênh.
                </div>

                {/* Tùy chọn Xóa toàn bộ dữ liệu lưu trữ */}
                <div className="pt-3 border-t border-slate-800/80">
                  <div className="p-3.5 bg-red-950/20 border border-red-900/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5 uppercase tracking-wide">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        Xóa toàn bộ dữ liệu lưu trữ
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        Giữ nguyên các kênh trong danh sách, xóa toàn bộ lịch sử view, sub, ngày tháng như kênh mới được thêm vào.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetConfirmOpen(true);
                        setResetPasswordInput("");
                        setResetPasswordError("");
                      }}
                      className="px-3.5 py-2 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-xs rounded-lg transition-all shadow-sm shadow-red-950/50 cursor-pointer whitespace-nowrap self-start sm:self-center"
                    >
                      XÓA TOÀN BỘ
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-2.5 bg-slate-200 hover:bg-white text-slate-900 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Xong
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Xác nhận Xóa toàn bộ dữ liệu */}
      <AnimatePresence>
        {isResetConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0D1426] border border-red-500/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl shadow-red-950/70"
            >
              <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-red-950/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/50 flex items-center justify-center text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Xác nhận xóa toàn bộ dữ liệu</h3>
                    <p className="text-[11px] text-red-400 font-semibold">Bảo mật hệ thống</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsResetConfirmOpen(false)}
                  disabled={isResetting}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Cảnh báo đe dọa khóa phần mềm */}
                <div className="p-3 bg-red-950/50 border border-red-500/60 rounded-xl text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-red-400 font-bold uppercase tracking-wider text-[11px]">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400 animate-pulse" />
                    <span>CẢNH BÁO QUAN TRỌNG:</span>
                  </div>
                  <p className="text-red-200 text-xs font-semibold leading-relaxed">
                    Nếu bạn nhập mật khẩu sai thì phần mềm này sẽ bị khóa!
                  </p>
                  <p className="text-[11px] text-slate-400 pt-1 border-t border-red-900/40 leading-relaxed">
                    (Thao tác này giữ nguyên các kênh đang theo dõi, nhưng sẽ xóa sạch toàn bộ view, sub, ngày tháng về ban đầu)
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    Nhập mật khẩu xác nhận:
                  </label>
                  <input
                    type="password"
                    autoFocus
                    value={resetPasswordInput}
                    onChange={(e) => {
                      setResetPasswordInput(e.target.value);
                      if (resetPasswordError) setResetPasswordError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleResetAllData();
                      }
                    }}
                    placeholder="Nhập mật khẩu để xóa..."
                    className={cn(
                      "w-full bg-[#070B16] border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none transition-all font-mono",
                      resetPasswordError 
                        ? "border-red-500 ring-1 ring-red-500/50" 
                        : "border-slate-700 focus:border-red-500"
                    )}
                  />
                  {resetPasswordError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium mt-1">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{resetPasswordError}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsResetConfirmOpen(false);
                      setResetPasswordInput("");
                      setResetPasswordError("");
                    }}
                    disabled={isResetting}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleResetAllData}
                    disabled={isResetting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold transition-all shadow-md shadow-red-950/50 cursor-pointer disabled:opacity-60"
                  >
                    {isResetting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang xử lý...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa toàn bộ dữ liệu</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast thông báo xóa thành công */}
      <AnimatePresence>
        {resetSuccessMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-50 max-w-md bg-emerald-950 border border-emerald-500/50 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-xs font-medium"
          >
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="flex-1">{resetSuccessMessage}</span>
            <button 
              onClick={() => setResetSuccessMessage("")} 
              className="text-emerald-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
