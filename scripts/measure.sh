#!/usr/bin/env bash
# 测量后端关键指标（curl-based）。
# 输出 JSON 报告到 stdout；CI / demo 可直接拿这个数。
#
# 用法：
#   ./scripts/measure.sh [BASE_URL]   # 默认 http://localhost:5174
#
# 测量项：
#   - /health 响应时间
#   - /channels 响应时间 + 大小
#   - /hls/:channel/master.m3u8 TTFB
#   - segment fetch TTFB（取 master 第一个分片 URL）
#   - 5 冷切换耗时（取主备 URL，反复 fetch）

set -euo pipefail

BASE_URL="${1:-http://localhost:5174}"
N_SWITCHES=5

# 用 python 做 JSON 输出和统计
python3 - "$BASE_URL" "$N_SWITCHES" <<'PY'
import sys
import json
import statistics
import time
import urllib.request
from urllib.parse import urljoin

base_url = sys.argv[1]
n_switches = int(sys.argv[2]) if len(sys.argv) > 2 else 5

def time_get(url):
    start = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'measure.sh/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return (time.perf_counter() - start) * 1000, resp.status, resp.read()
    except Exception as e:
        return (time.perf_counter() - start) * 1000, 0, str(e).encode()

results = {}

# /health
samples = [time_get(f"{base_url}/health") for _ in range(5)]
results['health_ms'] = {
    'p50': round(statistics.median([s[0] for s in samples]), 2),
    'p95': round(sorted([s[0] for s in samples])[int(0.95 * len(samples)) - 1], 2),
    'status': samples[0][1],
}

# /channels
t, status, body = time_get(f"{base_url}/channels")
channels = json.loads(body) if status == 200 else []
results['channels'] = {
    'response_ms': round(t, 2),
    'status': status,
    'count': len(channels),
    'size_bytes': len(body),
}

# 每个频道的 master TTFB
master_ttfbs = {}
for ch in channels:
    url = urljoin(base_url, ch['streamUrl'])
    samples = [time_get(url) for _ in range(3)]
    ok = [s for s in samples if s[1] == 200]
    if ok:
        master_ttfbs[ch['id']] = round(min(s[0] for s in ok), 2)
results['master_ttfb_ms'] = master_ttfbs

# 切源耗时模拟：取首频道的 master URL，5 次连续 fetch
if channels:
    primary = urljoin(base_url, channels[0]['streamUrl'])
    switch_samples = [time_get(primary) for _ in range(n_switches)]
    results['switch_equivalent_ms'] = {
        'p50': round(statistics.median([s[0] for s in switch_samples]), 2),
        'p95': round(sorted([s[0] for s in switch_samples])[int(0.95 * len(switch_samples)) - 1], 2),
        'note': 'cold-fetch p50/p95 across {} sequential requests (proxy of manifest)'.format(n_switches),
    }

# 输出
print(json.dumps(results, indent=2, ensure_ascii=False))
PY
