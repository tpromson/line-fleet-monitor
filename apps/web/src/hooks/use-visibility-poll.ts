import { useEffect, useRef } from 'react'

export function useVisibilityPoll(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback)
  useEffect(() => { savedCallback.current = callback }, [callback])

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId !== null) return
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          savedCallback.current()
        }
      }, delayMs)
    }

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current()
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [delayMs])
}
