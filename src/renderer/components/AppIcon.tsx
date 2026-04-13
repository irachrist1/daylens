import { useEffect, useState } from 'react'
import { ipc } from '../lib/ipc'
import { appInitials } from '../lib/apps'

const iconCache = new Map<string, string | null>()

export default function AppIcon({
  bundleId,
  appName,
  color = 'var(--color-primary)',
  size = 28,
  fontSize = 10,
  cornerRadius,
}: {
  bundleId?: string | null
  appName: string
  color?: string
  size?: number
  fontSize?: number
  cornerRadius?: number
}) {
  const cacheKey = bundleId ?? ''
  const [iconUrl, setIconUrl] = useState<string | null | undefined>(
    bundleId && iconCache.has(cacheKey) ? iconCache.get(cacheKey) : undefined,
  )

  useEffect(() => {
    if (!bundleId || iconCache.has(cacheKey)) return
    void ipc.db.getAppIcon(bundleId).then((url) => {
      iconCache.set(cacheKey, url)
      setIconUrl(url)
    })
  }, [bundleId, cacheKey])

  const rounded = cornerRadius ?? Math.round(size * 0.26)

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={appName}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: rounded,
          display: 'block',
          objectFit: 'contain',
          flexShrink: 0,
        }}
        onError={() => setIconUrl(null)}
      />
    )
  }

  // Derive a subtle background from the category color if provided
  const fallbackBg = color && color !== 'var(--color-primary)'
    ? (() => {
        const hex = color.replace('#', '')
        if (!/^[0-9a-fA-F]{3,6}$/.test(hex)) return 'var(--color-pill-bg)'
        const expanded = hex.length === 3 ? hex.split('').map((c) => `${c}${c}`).join('') : hex
        const v = Number.parseInt(expanded, 16)
        return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, 0.14)`
      })()
    : 'var(--color-pill-bg)'

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: fallbackBg,
        color,
        fontSize,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {appInitials(appName)}
    </div>
  )
}
