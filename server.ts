import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import fs from "fs";
import cron from "node-cron";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import JSON configuration safely
const firebaseConfigPath = path.resolve(__dirname, "./firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Firebase for server-side use
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Helper to format date consistent with App.tsx
const formatDate = (timestamp: number) => {
  const d = new Date(timestamp);
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
};

// Function to perform background refresh for all channels
async function autoRefreshChannels() {
  console.log(`[Cron] Starting auto-refresh at ${new Date().toLocaleString()}`);
  
  try {
    // 1. Fetch settings
    const settingsSnap = await getDoc(doc(db, "settings", "global"));
    if (!settingsSnap.exists()) {
      console.log("[Cron] No settings found, skipping.");
      return;
    }
    
    const settings = settingsSnap.data();
    let apiKeys = [...(settings.apiKeys || [])];
    let workingIndex = settings.lastUsedIndex || 0;
    const today = formatDate(Date.now());
    
    // Reset keys if it's a new day
    apiKeys = apiKeys.map(k => {
      if (k.lastResetDate !== today) {
        return { ...k, usageCount: 0, isExpired: false, lastResetDate: today };
      }
      return k;
    });

    // 2. Fetch channels
    const channelsSnap = await getDocs(collection(db, "channels"));
    const channels = channelsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (channels.length === 0 || apiKeys.length === 0) {
      console.log("[Cron] No channels or keys to process.");
      return;
    }

    // 3. Process each channel
    const now = Date.now();
    for (const channelObj of channels) {
      const channel = channelObj as any;

      // Rule: Xóa các kênh đã bị đánh dấu không tìm thấy trên YouTube
      if (channel.notFoundOnYouTube) {
        console.log(`[Auto-Clean] Channel ${channel.id} (${channel.title || 'Unknown'}) not found on YouTube. Automatically deleting from database.`);
        try {
          await deleteDoc(doc(db, "channels", channel.id));
        } catch (e: any) {
          console.error("Failed to delete channel", e.message);
        }
        continue;
      }

      // Rule: Xóa các kênh mà 150 ngày chưa làm video nào (pre-check)
      if (channel.lastVideoPublishedAt) {
        const pastDays = (now - new Date(channel.lastVideoPublishedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (pastDays >= 150) {
          console.log(`[Auto-Clean] Channel ${channel.id} (${channel.title || 'Unknown'}) has had no video for ${Math.floor(pastDays)} days (>= 150 days). Automatically deleting from database.`);
          try {
            await deleteDoc(doc(db, "channels", channel.id));
          } catch (e: any) {
            console.error("Failed to delete inactive channel", e.message);
          }
          continue;
        }
      }

      let attempts = 0;
      let selectedKeyInfo = null;

      while (attempts < apiKeys.length) {
        workingIndex = (workingIndex + 1) % apiKeys.length;
        const potentialKey = apiKeys[workingIndex];
        if (!potentialKey.isExpired) {
          selectedKeyInfo = potentialKey;
          break;
        }
        attempts++;
      }

      if (!selectedKeyInfo) {
        console.log("[Cron] All API keys exhausted.");
        break;
      }

      try {
        const response = await fetchYouTubeChannelInfo(channel.id, selectedKeyInfo.key, channel.customUrl);
        selectedKeyInfo.usageCount += 5;

        // Rule: Xóa các kênh mà 150 ngày chưa làm video nào (sau khi lấy dữ liệu mới nhất)
        if (response.lastVideoPublishedAt) {
          const daysSinceLastVideo = (now - new Date(response.lastVideoPublishedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceLastVideo >= 150) {
            console.log(`[Auto-Clean] Channel ${channel.id} (${response.title}) has had no video for ${Math.floor(daysSinceLastVideo)} days (>= 150 days). Automatically deleting from database.`);
            await deleteDoc(doc(db, "channels", channel.id));
            continue;
          }
        }

        const newViewCount = response.viewCount;
        const newVideoCount = response.videoCount;
        const todayStr = formatDate(now);

        let updatedViewHistory = Array.isArray(channel.viewHistory) ? [...channel.viewHistory] : [];
        const lastEntry = updatedViewHistory.length > 0 ? updatedViewHistory[updatedViewHistory.length - 1] : null;
        
        // We track if either view count or video count changed
        const isDifferentCount = lastEntry ? (lastEntry.viewCount !== newViewCount || lastEntry.videoCount !== newVideoCount) : true;
        const isSameDay = lastEntry ? formatDate(lastEntry.timestamp) === todayStr : false;

        if (isSameDay && lastEntry) {
          // Cập nhật mốc chốt trong ngày (đặc biệt các lần quét cuối ngày gần 24:00)
          updatedViewHistory[updatedViewHistory.length - 1] = { 
            viewCount: newViewCount, 
            videoCount: newVideoCount,
            timestamp: now 
          };
        } else {
          // Sang ngày mới: tạo mốc snapshot mới cho ngày mới
          updatedViewHistory.push({ 
            viewCount: newViewCount, 
            videoCount: newVideoCount,
            timestamp: now 
          });
        }

        const updateData: any = {
          subscriberCount: response.subscriberCount,
          videoCount: response.videoCount,
          viewCount: newViewCount,
          lastVideoPublishedAt: response.lastVideoPublishedAt,
          thumbnail: response.thumbnail,
          title: response.title,
          viewHistory: updatedViewHistory
        };
        if (channel.notFoundOnYouTube) {
          updateData.notFoundOnYouTube = false;
        }

        await updateDoc(doc(db, "channels", channel.id), updateData);

      } catch (err: any) {
        if (err.response?.status === 403) {
          selectedKeyInfo.isExpired = true;
        }

        // Rule: Kênh không tìm thấy hoặc bị xóa trên YouTube -> Tự động xóa khỏi danh sách kênh
        if (err.message === "Channel not found" || err.response?.status === 404) {
          console.warn(`[Auto-Clean] Channel ${channel.id} (${channel.title || 'Unknown'}) not found/deleted on YouTube. Automatically deleting from database.`);
          try {
            await deleteDoc(doc(db, "channels", channel.id));
          } catch (delErr: any) {
            console.error("Failed to delete missing channel", delErr.message);
          }
        } else {
          console.error(`[Cron] Failed to refresh channel ${channel.id}:`, err.message);
        }
      }
    }

    // 4. Update settings back to Firestore with daily scan count (48 scans/day schedule)
    const newDailyScanCount = (settings.lastScanDate === today ? (settings.dailyScanCount || 0) : 0) + 1;
    await updateDoc(doc(db, "settings", "global"), {
      apiKeys: apiKeys,
      lastUsedIndex: workingIndex,
      lastCronCompletion: Date.now(),
      dailyScanCount: newDailyScanCount,
      lastScanDate: today
    });
    
    console.log(`[Cron] Auto-refresh completed at ${new Date().toLocaleString()}. Daily scan #${newDailyScanCount}`);
  } catch (error) {
    console.error("[Cron] Global error in auto-refresh:", error);
  }
}

// Internal helper for YouTube API calls (shared logic)
async function fetchYouTubeChannelInfo(channelId: string, apiKey: string, customUrl?: string) {
  const searchUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`;
  let response = await axios.get(searchUrl);

  if ((!response.data.items || response.data.items.length === 0) && customUrl) {
    try {
      const cleanHandle = customUrl.startsWith("@") ? customUrl : `@${customUrl}`;
      const handleUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(cleanHandle)}&key=${apiKey}`;
      const handleResponse = await axios.get(handleUrl);
      if (handleResponse.data.items && handleResponse.data.items.length > 0) {
        response = handleResponse;
      }
    } catch {
      // ignore fallback error
    }
  }

  if (!response.data.items || response.data.items.length === 0) {
    throw new Error("Channel not found");
  }

  const channel = response.data.items[0];
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  let lastVideoPublishedAt = null;

  // Cheap logic first
  try {
    const activitiesUrl = `https://www.googleapis.com/youtube/v3/activities?part=snippet,contentDetails&channelId=${channel.id}&maxResults=5&key=${apiKey}`;
    const activitiesResponse = await axios.get(activitiesUrl);
    if (activitiesResponse.data.items && activitiesResponse.data.items.length > 0) {
      const uploadActivity = activitiesResponse.data.items.find((item: any) => item.snippet.type === "upload");
      if (uploadActivity) {
        lastVideoPublishedAt = uploadActivity.snippet.publishedAt;
      } else if (activitiesResponse.data.items[0].snippet.publishedAt) {
        lastVideoPublishedAt = activitiesResponse.data.items[0].snippet.publishedAt;
      }
    }
  } catch (vError: any) {
    console.error("Activities fail", vError.message);
  }

  if (!lastVideoPublishedAt && uploadsPlaylistId) {
    try {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=1&key=${apiKey}`;
      const playlistResponse = await axios.get(playlistUrl);
      if (playlistResponse.data.items && playlistResponse.data.items.length > 0) {
        lastVideoPublishedAt = playlistResponse.data.items[0].snippet.publishedAt;
      }
    } catch (vError: any) {
      console.error("Playlist fail", vError.message);
    }
  }

  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails.medium?.url || channel.snippet.thumbnails.default?.url,
    subscriberCount: channel.statistics.subscriberCount,
    videoCount: channel.statistics.videoCount,
    viewCount: channel.statistics.viewCount,
    customUrl: channel.snippet.customUrl,
    lastVideoPublishedAt: lastVideoPublishedAt || null
  };
}

// Cron quét tự động nội bộ mỗi 30 phút (48 lần/ngày, chốt vào 24h) chạy trực tiếp trong server Node.js
cron.schedule("*/30 * * * *", () => {
  autoRefreshChannels();
}, {
  timezone: "Asia/Ho_Chi_Minh"
});

// Manual / External trigger API
app.all("/api/admin/refresh", async (req, res) => {
  autoRefreshChannels();
  res.json({ status: "ok", message: "Auto-refresh triggered successfully" });
});

// Original API to fetch YouTube channel info (for adding new channels)
app.get("/api/youtube/channel", async (req, res) => {
  const { url, key } = req.query;
  const apiKey = (key as string) || process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: "Thiếu API Key." });
  }

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL không hợp lệ." });
  }

  try {
    let channelId = "";
    let handle = "";

    // Parse URL (Simplified for server side use of original logic)
    if (url.includes("/channel/")) {
      channelId = url.split("/channel/")[1].split(/[?#]/)[0];
    } else if (url.includes("/@")) {
      handle = "@" + url.split("/@")[1].split(/[?#]/)[0];
    } else if (url.includes("/user/")) {
      handle = url.split("/user/")[1].split(/[?#]/)[0];
    } else {
      const parts = url.split("/");
      const lastPart = parts[parts.length - 1];
      if (lastPart.startsWith("@")) {
        handle = lastPart;
      } else {
        if (url.length > 20 && !url.includes(".")) {
            channelId = url;
        } else {
            return res.status(400).json({ error: "Định dạng URL YouTube không hợp lệ." });
        }
      }
    }

    let finalId = channelId;
    if (!finalId && handle) {
       const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
       const searchByHandleUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(cleanHandle)}&key=${apiKey}`;
       const handleResponse = await axios.get(searchByHandleUrl);
       if (handleResponse.data.items && handleResponse.data.items.length > 0) {
         finalId = handleResponse.data.items[0].id;
       } else {
         const searchApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&key=${apiKey}&maxResults=1`;
         const searchResponse = await axios.get(searchApiUrl);
         if (searchResponse.data.items && searchResponse.data.items.length > 0) {
           finalId = searchResponse.data.items[0].snippet.channelId;
         }
       }
    }

    if (!finalId) {
      return res.status(404).json({ error: "Không tìm thấy kênh YouTube này." });
    }

    const result = await fetchYouTubeChannelInfo(finalId, apiKey);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: "Lỗi hệ thống khi gọi YouTube." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[Cron] Scheduled for: 0,3,6,9,12,15,18,21h`);

    // Catch-up refresh for serverless environments (Cloud Run)
    // More aggressive on startup to ensure we don't miss data
    try {
      const settingsSnap = await getDoc(doc(db, "settings", "global"));
      let shouldRun = true;
      if (settingsSnap.exists()) {
        const lastRun = settingsSnap.data().lastCronCompletion || 0;
        const timeSinceLastRun = Date.now() - lastRun;
        // If last run was more than 1 hour ago, or we've never run
        if (timeSinceLastRun < 1 * 60 * 60 * 1000) {
          shouldRun = false;
          console.log(`[Cron] Last run was ${Math.round(timeSinceLastRun / 60000)}m ago. Skipping startup refresh.`);
        }
      }

      if (shouldRun) {
        console.log("[Cron] Missed windows detected or first start. Running refresh...");
        autoRefreshChannels(); // Run in background
      }
    } catch (err) {
      console.error("[Cron] Startup check failed:", err);
    }
  });
}

startServer();
