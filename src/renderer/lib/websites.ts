export type WebsiteCategoryLabel =
  | 'Development'
  | 'Research'
  | 'Productivity'
  | 'Communication'
  | 'Social'
  | 'Entertainment'
  | 'News'
  | 'General'

const DOMAIN_GROUPS: Array<{ label: WebsiteCategoryLabel; patterns: RegExp[] }> = [
  {
    label: 'Development',
    patterns: [/github\./i, /gitlab\./i, /stackoverflow\./i, /vercel\./i, /npmjs\./i, /linear\.app/i],
  },
  {
    label: 'Research',
    patterns: [/wikipedia\./i, /arxiv\./i, /readthedocs\./i, /developer\.mozilla\./i, /docs\./i],
  },
  {
    label: 'Productivity',
    patterns: [/notion\./i, /calendar\./i, /drive\.google\./i, /docs\.google\./i, /figma\./i],
  },
  {
    label: 'Communication',
    patterns: [/mail\./i, /gmail\./i, /slack\./i, /teams\.microsoft\./i, /discord\./i],
  },
  {
    label: 'Social',
    patterns: [/twitter\./i, /x\.com/i, /linkedin\./i, /reddit\./i, /facebook\./i, /instagram\./i],
  },
  {
    label: 'Entertainment',
    patterns: [/youtube\./i, /netflix\./i, /twitch\./i, /spotify\./i, /hulu\./i, /primevideo\./i],
  },
  {
    label: 'News',
    patterns: [/news\./i, /nytimes\./i, /bbc\./i, /cnn\./i, /theverge\./i, /wsj\./i],
  },
]

export function classifyWebsiteDomain(domain: string): WebsiteCategoryLabel {
  for (const group of DOMAIN_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(domain))) {
      return group.label
    }
  }
  return 'General'
}

export function isDistractingWebsiteCategory(category: WebsiteCategoryLabel): boolean {
  return category === 'Social' || category === 'Entertainment' || category === 'News'
}
