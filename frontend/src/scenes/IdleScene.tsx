import { useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { watchGyro } from '../utils/gyro'

const STAR_COUNT = 700

function StarField({ volume }: { volume: number }) {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  const posRef = useRef<Float32Array | null>(null)
  const linePositions = useRef(new Float32Array(STAR_COUNT * 6))
  const speedRef = useRef(2.5)

  if (!posRef.current) {
    const arr = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 8
      arr[i * 3 + 1] = (Math.random() - 0.5) * 8
      arr[i * 3 + 2] = -Math.random() * 50
    }
    posRef.current = arr
  }

  useFrame((_, delta) => {
    if (!geoRef.current || !posRef.current) return
    const pos = posRef.current
    const lp = linePositions.current
    const targetSpeed = 2.5 + volume * 8
    speedRef.current += (targetSpeed - speedRef.current) * delta * 3
    const speed = speedRef.current
    const trailLen = Math.max(0.04, speed * 0.05)

    for (let i = 0; i < STAR_COUNT; i++) {
      pos[i * 3 + 2] += speed * delta
      if (pos[i * 3 + 2] > 1) {
        pos[i * 3]     = (Math.random() - 0.5) * 8
        pos[i * 3 + 1] = (Math.random() - 0.5) * 8
        pos[i * 3 + 2] = -50
      }
      const x = pos[i * 3]; const y = pos[i * 3 + 1]; const z = pos[i * 3 + 2]
      lp[i * 6]     = x; lp[i * 6 + 1] = y; lp[i * 6 + 2] = z
      lp[i * 6 + 3] = x; lp[i * 6 + 4] = y; lp[i * 6 + 5] = z - trailLen
    }

    const attr = geoRef.current.attributes.position as THREE.BufferAttribute
    attr.array.set(lp)
    attr.needsUpdate = true
  })

  return (
    <lineSegments>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[linePositions.current, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#c8a870" transparent opacity={0.65} />
    </lineSegments>
  )
}

interface Props { volume: number }

export default function IdleScene({ volume }: Props) {
  const [tilt, setTilt] = useState({ beta: 0, gamma: 0 })
  useEffect(() => watchGyro(setTilt), [])

  return (
    <Canvas
      camera={{ position: [tilt.gamma * 0.006, -tilt.beta * 0.006, 0.5], fov: 75 }}
      style={{ position: 'absolute', inset: 0 }}
      gl={{ antialias: false, alpha: true }}
    >
      <StarField volume={volume} />
    </Canvas>
  )
}
