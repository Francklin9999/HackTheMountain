import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const STAR_COUNT = 1600

function WarpSpeed() {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  const posRef = useRef<Float32Array | null>(null)
  const linePositions = useRef(new Float32Array(STAR_COUNT * 6))
  const timeRef = useRef(0)

  if (!posRef.current) {
    const arr = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 10
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10
      arr[i * 3 + 2] = -Math.random() * 50
    }
    posRef.current = arr
  }

  useFrame((_, delta) => {
    if (!geoRef.current || !posRef.current) return
    timeRef.current += delta
    const t = timeRef.current
    const pos = posRef.current
    const lp = linePositions.current
    const speed = Math.min(80, 6 + t * t * 9)
    const trailLen = Math.min(speed * 0.1, 7)

    for (let i = 0; i < STAR_COUNT; i++) {
      pos[i * 3 + 2] += speed * delta
      if (pos[i * 3 + 2] > 1) {
        pos[i * 3]     = (Math.random() - 0.5) * 10
        pos[i * 3 + 1] = (Math.random() - 0.5) * 10
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
      <lineBasicMaterial color="#d4a850" transparent opacity={0.85} />
    </lineSegments>
  )
}

export default function TimeTunnel() {
  return (
    <Canvas
      camera={{ position: [0, 0, 0.5], fov: 80 }}
      style={{ position: 'absolute', inset: 0 }}
      gl={{ antialias: false, alpha: false }}
    >
      <color attach="background" args={['#121009']} />
      <WarpSpeed />
    </Canvas>
  )
}
