"use client"

import { Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PLAYBACK_SPEEDS } from "@/lib/flowPlayback"
import { formatJst } from "@/lib/usageFormat"

interface OrgReplayControlsProps {
  since: number
  until: number
  /** 再生位置(実時間の時刻) */
  t: number
  playing: boolean
  speed: number
  skipIdle: boolean
  /** 再生位置のスライダーの下に出す目印(指示=青、報告=緑)の時刻 */
  marks: { instruct: number[]; report: number[] }
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onSpeed: (speed: number) => void
  onSkipIdle: (skip: boolean) => void
}

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

/** 振り返りの操作: 再生／一時停止、速さ、空き時間を飛ばす、再生位置(目印つき)、時計(日本時間) */
export function OrgReplayControls({
  since,
  until,
  t,
  playing,
  speed,
  skipIdle,
  marks,
  onTogglePlay,
  onSeek,
  onSpeed,
  onSkipIdle,
}: OrgReplayControlsProps) {
  const span = Math.max(1, until - since)
  const position = (time: number) => `${Math.max(0, Math.min(100, ((time - since) / span) * 100))}%`
  return (
    <section aria-label="振り返りの操作" data-testid="org-replay" className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="outline" size="sm" aria-label="再生" aria-pressed={playing} onClick={onTogglePlay}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? "一時停止" : "再生"}
        </Button>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          速さ
          <select aria-label="速さ" className={selectClass} value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            aria-label="空き時間を飛ばす"
            className="size-4 accent-[var(--primary)]"
            checked={skipIdle}
            onChange={(e) => onSkipIdle(e.target.checked)}
          />
          空き時間を飛ばす
        </label>
        <span className="ml-auto text-sm tabular-nums" data-testid="org-clock" aria-live="off">
          {formatJst(t)}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          aria-label="再生位置"
          className="w-full accent-[var(--primary)]"
          min={since}
          max={until}
          step={1000}
          value={Math.max(since, Math.min(until, t))}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <div className="relative h-3" aria-hidden>
          {marks.instruct.map((time, i) => (
            <i key={`d${i}`} className="absolute top-0 h-2.5 w-0.5 rounded-sm bg-[var(--flow-down)]" style={{ left: position(time) }} />
          ))}
          {marks.report.map((time, i) => (
            <i key={`u${i}`} className="absolute top-0.5 h-2 w-0.5 rounded-sm bg-[var(--flow-up)]" style={{ left: position(time) }} />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        範囲 {formatJst(since)} 〜 {formatJst(until)}。目印: 青＝指示、緑＝報告。状態バッジと送信回数は、再生位置ではなく現在の値です。
      </p>
    </section>
  )
}
