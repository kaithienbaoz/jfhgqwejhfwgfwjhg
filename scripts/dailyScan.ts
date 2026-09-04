import path from "path";
import axios from "axios";
import fs from "fs";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, getDoc, deleteDoc } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đọc cấu hình Firebase từ firebase-applet-config.json
const configPath = path.resolve(__dirname, "../firebase-applet-config.json");
if (!fs.existsSync(configPath)) {
  console.error("Không tìm thấy tệp cấu hình firebase-applet-config.json");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Định dạng ngày DD-MM-YYYY
const formatDate = (timestamp: number) => {
  const d = new Date(timestamp);
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
};

// Hàm gọi API YouTube
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
      // Bỏ qua lỗi fallback
    }
  }

  if (!response.data.items || response.data.items.length === 0) {
    throw new Error("Channel not found");
  }

  const channel = response.data.items[0];
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  let lastVideoPublishedAt = null;

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
    console.warn("Activities fail", vError.message);
  }

  if (!lastVideoPublishedAt && uploadsPlaylistId) {
    try {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=1&key=${apiKey}`;
      const playlistResponse = await axios.get(playlistUrl);
      if (playlistResponse.data.items && playlistResponse.data.items.length > 0) {
        lastVideoPublishedAt = playlistResponse.data.items[0].snippet.publishedAt;
      }
    } catch (vError: any) {
      console.warn("Playlist fail", vError.message);
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

async function runDailyScan() {
  console.log(`=====================================================`);
  console.log(`[GitHub Actions] Bắt đầu quét YouTube lúc ${new Date().toLocaleString()}`);
  console.log(`=====================================================`);

  try {
    // 1. Đọc settings từ Firestore
    const settingsDoc = await getDoc(doc(db, "settings", "global"));
    const settings = settingsDoc.exists() ? settingsDoc.data() : { apiKeys: [], lastUsedIndex: 0 };
    const apiKeys = settings.apiKeys || [];

    if (apiKeys.length === 0) {
      console.warn("[Cảnh báo] Chưa có YouTube API Key nào được cài đặt trong settings.");
      return;
    }

    // 2. Lấy danh sách kênh
    const channelsSnapshot = await getDocs(collection(db, "channels"));
    const channels = channelsSnapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    console.log(`Tìm thấy ${channels.length} kênh cần quét.`);

    let workingIndex = settings.lastUsedIndex || 0;
    const now = Date.now();
    const todayStr = formatDate(now);

    // 3. Quét từng kênh
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      let selectedKeyInfo = apiKeys[workingIndex];

      // Tìm key còn hạn
      if (!selectedKeyInfo || selectedKeyInfo.isExpired) {
        const availableIndex = apiKeys.findIndex((k: any) => !k.isExpired);
        if (availableIndex !== -1) {
          workingIndex = availableIndex;
          selectedKeyInfo = apiKeys[workingIndex];
        } else {
          console.warn("[Cảnh báo] Toàn bộ YouTube API Key đã hết hạn hoặc quá hạn mức.");
          break;
        }
      }

      try {
        console.log(`Đang quét kênh: ${channel.title || channel.id}...`);
        const response = await fetchYouTubeChannelInfo(channel.id, selectedKeyInfo.key, channel.customUrl);
        selectedKeyInfo.usageCount = (selectedKeyInfo.usageCount || 0) + 1;

        const newViewCount = response.viewCount || "0";
        const newVideoCount = response.videoCount || "0";

        const currentViewHistory: any[] = channel.viewHistory ? [...channel.viewHistory] : [];
        const lastEntry = currentViewHistory.length > 0 ? currentViewHistory[currentViewHistory.length - 1] : null;
        const isSameDay = lastEntry ? formatDate(lastEntry.timestamp) === todayStr : false;

        if (isSameDay && lastEntry) {
          // Chốt điểm cuối của ngày (24:00)
          currentViewHistory[currentViewHistory.length - 1] = {
            viewCount: newViewCount,
            videoCount: newVideoCount,
            timestamp: now
          };
        } else {
          currentViewHistory.push({
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
          viewHistory: currentViewHistory
        };

        if (channel.notFoundOnYouTube) {
          updateData.notFoundOnYouTube = false;
        }

        await updateDoc(doc(db, "channels", channel.id), updateData);
        console.log(`=> Kênh [${response.title}]: View = ${newViewCount}, Video = ${newVideoCount}`);

      } catch (err: any) {
        if (err.response?.status === 403) {
          selectedKeyInfo.isExpired = true;
          console.warn(`API Key hết hạn mức: ${selectedKeyInfo.key.slice(0, 8)}...`);
        }

        if (err.message === "Channel not found" || err.response?.status === 404) {
          console.warn(`Kênh ${channel.id} không tìm thấy trên YouTube. Tự động xóa.`);
          try {
            await deleteDoc(doc(db, "channels", channel.id));
          } catch (delErr: any) {
            console.error("Lỗi khi xóa kênh:", delErr.message);
          }
        } else {
          console.error(`Lỗi quét kênh ${channel.id}:`, err.message);
        }
      }
    }

    // 4. Lưu lại thông số settings vào Firestore
    const newDailyScanCount = (settings.lastScanDate === todayStr ? (settings.dailyScanCount || 0) : 0) + 1;
    await updateDoc(doc(db, "settings", "global"), {
      apiKeys: apiKeys,
      lastUsedIndex: workingIndex,
      lastCronCompletion: Date.now(),
      dailyScanCount: newDailyScanCount,
      lastScanDate: todayStr
    });

    console.log(`=====================================================`);
    console.log(`[Thành công] Quét xong toàn bộ kênh lúc ${new Date().toLocaleString()}`);
    console.log(`=====================================================`);

  } catch (error) {
    console.error("[Lỗi nghiêm trọng trong runDailyScan]:", error);
    process.exit(1);
  }
}

runDailyScan().then(() => {
  process.exit(0);
});
