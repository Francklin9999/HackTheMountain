import { useEffect, useRef } from 'react'
import { getAnalyser } from '../audio/player'

interface Props {
  playing: boolean
  color?: string
}

export default function Waveform({ playing, color = 'oklch(0.72 0.12 72)' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const phaseRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      const analyser = getAnalyser()

      if (!playing) {
        ctx.beginPath()
        ctx.moveTo(0, height / 2)
        ctx.lineTo(width, height / 2)
        ctx.strokeStyle = `${color}33`
        ctx.lineWidth = 1
        ctx.stroke()
        return
      }

      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteTimeDomainData(dataArray)
        const sliceWidth = width / dataArray.length
        ctx.beginPath()
        dataArray.forEach((val, i) => {
          const v = val / 128.0
          const y = (v * height) / 2
          if (i === 0) ctx.moveTo(i * sliceWidth, y)
          else ctx.lineTo(i * sliceWidth, y)
        })
        ctx.lineTo(width, height / 2)
      } else {
        phaseRef.current += 0.04
        const p = phaseRef.current
        ctx.beginPath()
        for (let x = 0; x < width; x++) {
          const t = x / width
          const y = height / 2
            + Math.sin(t * Math.PI * 6 + p) * height * 0.18
            + Math.sin(t * Math.PI * 11 + p * 1.3) * height * 0.08
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      }

      ctx.strokeStyle = color
      ctx.lineWidth = analyser ? 2 : 1.5
      ctx.shadowColor = color
      ctx.shadowBlur = analyser ? 10 : 6
      ctx.stroke()
      ctx.shadowBlur = 0

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, color])

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={50}
      style={{ width: '100%', height: 50, display: 'block' }}
    />
  )
}
