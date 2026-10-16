'use client'

import { MusicIcon, PauseIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cobweb/ui/components/tooltip'

/**
 * The page's track, in the top bar (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8): play and pause,
 * never playing on load, looping once started, with the avatar as its cover in the system's media controls.
 */
export function MusicButton({
  music,
  artwork,
  title,
}: {
  music: { url: string; fileName: string }
  artwork: string | null
  title: string
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const toggle = () => {
    const element = audio.current
    if (!element) return
    if (!element.paused) return element.pause()
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: music.fileName,
        artist: title,
        artwork: artwork ? [{ src: artwork }] : [],
      })
    void element.play().catch(() => setPlaying(false))
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? 'Pause music' : 'Play music'}
            onClick={toggle}
          >
            {playing ? <PauseIcon /> : <MusicIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{music.fileName}</TooltipContent>
      </Tooltip>
      <audio
        ref={audio}
        src={music.url}
        preload="none"
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </>
  )
}
