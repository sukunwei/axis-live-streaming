#!/usr/bin/env python3
"""
Analyze playback logs from /tmp/playback-YYYYMMDD.jsonl.

Per-channel aggregation:
  - samples, session span
  - average + max stalls / dropped / buffer / bitrate / fps
  - 95th percentile buffer

Usage: ./scripts/analyze-playback.py [LOG_FILE]
  default: latest /tmp/playback-*.jsonl
"""
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from glob import glob


def latest_log() -> str:
    files = sorted(glob('/tmp/playback-*.jsonl'))
    if not files:
        sys.exit('no /tmp/playback-*.jsonl found')
    return files[-1]


def load(path: str) -> list[dict]:
    samples = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                samples.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return samples


def aggregate(samples: list[dict]) -> dict:
    by_channel = defaultdict(list)
    for s in samples:
        if s.get('channelId'):
            by_channel[s['channelId']].append(s)

    report = {}
    for ch, items in by_channel.items():
        sample_only = [s for s in items if s.get('event', 'sample') == 'sample']
        if not sample_only:
            continue
        stalls = [s.get('stalls', 0) or 0 for s in sample_only]
        total_stall_ms = [s.get('totalStallMs', 0) or 0 for s in sample_only]
        dropped = [s.get('droppedFrames', 0) or 0 for s in sample_only]
        decoded = [s.get('decodedFrames', 0) or 0 for s in sample_only]
        buf = [s.get('avgBufferSec', 0) or 0 for s in sample_only]
        bitrate = [s.get('avgBitrateKbps', 0) or 0 for s in sample_only]
        fps = [s.get('avgFps', 0) or 0 for s in sample_only]
        timestamps = sorted(s.get('ts', 0) for s in sample_only if s.get('ts'))

        # monotonic deltas
        def delta(seq):
            if len(seq) < 2:
                return [0]
            d = [0]
            for i in range(1, len(seq)):
                d.append(max(0, seq[i] - seq[i-1]))
            return d

        stall_deltas = delta(stalls)
        dropped_deltas = delta(dropped)
        stall_ms_deltas = delta(total_stall_ms)

        buf_sorted = sorted(b for b in buf if b > 0)
        p50 = statistics.median(buf_sorted) if buf_sorted else 0
        p95 = buf_sorted[int(0.95 * len(buf_sorted))] if buf_sorted else 0

        span_sec = 0
        if len(timestamps) >= 2:
            span_sec = (timestamps[-1] - timestamps[0]) / 1000

        report[ch] = {
            'samples': len(sample_only),
            'span_sec': round(span_sec),
            'total_stalls': stalls[-1] if stalls else 0,
            'total_dropped': dropped[-1] if dropped else 0,
            'total_stall_ms': total_stall_ms[-1] if total_stall_ms else 0,
            'stalldelta_per_sample': round(sum(stall_deltas) / max(1, len(stall_deltas)), 3),
            'stallms_per_sample': round(sum(stall_ms_deltas) / max(1, len(stall_ms_deltas)), 1),
            'droppeddelta_per_sample': round(sum(dropped_deltas) / max(1, len(dropped_deltas)), 2),
            'avg_buffer_sec': round(p50, 2),
            'p95_buffer_sec': round(p95, 2),
            'min_buffer_sec': round(min(b for b in buf if b > 0), 2) if any(b > 0 for b in buf) else 0,
            'avg_bitrate_kbps': round(statistics.mean([b for b in bitrate if b > 0]) if any(b > 0 for b in bitrate) else 0),
            'avg_fps': round(statistics.mean([f for f in fps if f > 0]) if any(f > 0 for f in fps) else 0),
        }

    return report


def render(report: dict, log_path: str) -> None:
    print(f'\n  log: {log_path}')
    print(f'  channels: {len(report)}\n')
    if not report:
        print('  no sample data (only mount/unmount events?)')
        return

    print(f'  {"channel":18s} {"samples":>8s} {"span(s)":>9s} {"stalls":>7s} {"stallms":>8s} {"dropped":>8s} {"avgBuf":>7s} {"p95Buf":>7s} {"minBuf":>7s} {"kbps":>6s} {"fps":>4s}')
    print(f'  {"-" * 110}')

    # Rank by smoothness = (stalls + 1) * (dropped + 1) / span
    ranked = sorted(report.items(), key=lambda kv: (kv[1]['total_stalls'] + 1) * (kv[1]['total_dropped'] + 1))

    for ch, s in ranked:
        span = s['span_sec']
        print(f'  {ch:18s} {s["samples"]:>8d} {span:>9d} {s["total_stalls"]:>7d} {s["total_stall_ms"]:>8d} {s["total_dropped"]:>8d} {s["avg_buffer_sec"]:>7.1f} {s["p95_buffer_sec"]:>7.1f} {s["min_buffer_sec"]:>7.1f} {s["avg_bitrate_kbps"]:>6.0f} {s["avg_fps"]:>4.0f}')

    print()
    print('  ranking (smoother first): total_stalls * total_dropped ascending')
    print()
    print('  smoothest:', ranked[0][0] if ranked else '?')
    print('  worst:    ', ranked[-1][0] if ranked else '?')


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else latest_log()
    samples = load(path)
    print(f'  loaded {len(samples)} samples from {path}')
    if not samples:
        sys.exit('no samples')
    report = aggregate(samples)
    render(report, path)


if __name__ == '__main__':
    main()
