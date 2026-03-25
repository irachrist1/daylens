import { useEffect, useState } from 'react'

function readViewportWidth(): number {
  if (typeof window === 'undefined') return 1440
  return window.innerWidth
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readViewportWidth)

  useEffect(() => {
    const handleResize = () => setWidth(readViewportWidth())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width
}

export function getPagePadding(width: number): number {
  if (width < 960) return 16
  if (width < 1280) return 24
  return 40
}
