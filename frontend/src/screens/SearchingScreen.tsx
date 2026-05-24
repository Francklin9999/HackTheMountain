import { lazy, Suspense } from 'react'
import { motion } from 'framer-motion'

const TimeTunnel = lazy<React.ComponentType>(() =>
  import('../scenes/TimeTunnel').catch(() => ({ default: () => null as unknown as React.ReactElement }))
)

export default function SearchingScreen() {
  return (
    <div className="searching-screen">
      <Suspense fallback={null}>
        <TimeTunnel />
      </Suspense>

      <motion.div
        className="searching-screen__content"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="searching-screen__disc">
          <div className="searching-screen__disc-outer" />
          <div className="searching-screen__disc-inner" />
          <div className="searching-screen__disc-core" />
          <div className="searching-screen__disc-sweep" />
        </div>

        <div className="searching-screen__text">
          <p className="searching-screen__label">Searching the archive</p>
          <p className="searching-screen__sublabel">
            Matching your melody against Québec folk recordings…
          </p>
          <div className="searching-screen__progress">
            <div className="searching-screen__progress-bar" />
          </div>
        </div>
      </motion.div>
    </div>
  )
}
