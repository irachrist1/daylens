import { useEffect, useState } from 'react'

export function useCompactLayout(maxWidth = 1119): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth <= maxWidth)

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= maxWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxWidth])

  return compact
}
