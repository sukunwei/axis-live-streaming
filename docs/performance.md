針對你使用的這類 Akamai 託管的免費公共 HLS 直播源，前端直接加載往往會因為跨域 (CORS) 限制、網路路徑不穩定、或播放器緩衝策略不當導致卡頓。透過 Node.js 做一層 Proxy（中轉/代理）是極佳的優化方案。以下是針對性的性能優化實戰建議：一、 Node.js Proxy 層優化方案使用 Node.js 不僅是為了解決跨域，更重要的是做內容緩存和鏈路併發控制。1. 核心實作邏輯 (使用 express + http-proxy-middleware)javascriptconst express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const NodeCache = require('node-cache');

const app = express();
const m3u8Cache = new NodeCache({ stdTTL: 2 }); // 索引文件緩存 2 秒

// 1. 優化：對 .m3u8 索引文件做極短緩存，避免每個用戶都向原站發起請求
app.get('/live/index.m3u8', async (req, res, next) => {
    const cachedData = m3u8Cache.get('index');
    if (cachedData) return res.send(cachedData);
    next();
});

// 2. 代理設置
app.use('/live', createProxyMiddleware({
    target: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/',
    changeOrigin: true,
    pathRewrite: { '^/live': '' },
    onProxyRes: (proxyRes, req, res) => {
        // 解決跨域，允許瀏覽器直接讀取
        res.setHeader('Access-Control-Allow-Origin', '*');
        // 優化：針對 .ts 切片增加瀏覽器端緩存時間
        if (req.url.endsWith('.ts')) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

app.listen(3000);
請謹慎使用程式碼。2. Proxy 層的關鍵優化點：併發聚合 (Request Collapsing)：當 100 個用戶同時進來時，Proxy 只向 Akamai 請求一次 .m3u8，然後分發給所有人。這能極大減少因為源站限流導致的失敗。Keep-Alive 鏈路復用：在 Node.js 中配置 http.Agent 保持與 Akamai 的長連接，減少每次請求切片時的 TCP 握手時間。路徑優化：如果你的服務器部署在海外（如香港、新加坡），利用服務器的骨幹網訪問 Akamai，再由服務器轉發給國內用戶，通常比用戶直接訪問更穩。二、 前端播放器優化 (基於 hls.js)直接用 <video> 標籤性能很差，建議使用 hls.js 並調整底層參數：javascriptconst video = document.getElementById('video');
const hls = new Hls({
    // 1. 減少首幀等待時間
    maxBufferLength: 30,        // 最大緩衝 30 秒，防止內存溢出
    maxMaxBufferLength: 60,
    // 2. 優化起播速度
    startLevel: -1,             // 自動選擇最佳碼率
    abandonLoadTimeout: 3000,   // 加載切片超過 3s 自動切換
    // 3. 追幀優化：防止延遲累積
    liveSyncDurationCount: 3,   // 始終保持在倒數第 3 個切片，保證實時性
    liveMaxLatencyDurationCount: 10, // 超過 10 個切片就強制跳轉到最新位置
});

hls.loadSource('/live/index.m3u8'); // 調用你的 Node.js Proxy 地址
hls.attachMedia(video);
請謹慎使用程式碼。三、 針對免費源的「避坑」策略分片預取 (Prefetching)：在 Node.js Proxy 中，當檢測到用戶請求了 segment_1.ts，後端可以偷偷開始異步下載 segment_2.ts 到內存。這樣用戶請求下一個片段時，就是毫秒級響應。備用源切換：免費源隨時可能失效或針對特定 IP 封鎖。在 Node.js 層做個簡單的監控，如果 index.m3u8 返回 403 或 404，自動切換到其他備用直播流地址，前端無需感知。防止內存洩漏：體育直播通常掛載時間長。前端務必監控 hls.BUFFER_FULL_ERROR 事件，一旦觸發，立即清理緩衝區 hls.flushBuffer()。