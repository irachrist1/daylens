# Daylens — MVP Status and Todos

## Completed

- Pipeline connected: capture -> filter -> debounce -> resolve -> persist -> normalize -> classify -> daily summary
- AI wired: AIAnalyst + ConversationManager with Anthropic SDK (Sonnet 4.6, Opus 4.6, Haiku 4.5)
- Permissions: Accessibility, Screen Recording, Automation (AppleScript) all functional
- Onboarding: 5-step flow with browser access prompt (no extension requirement)
- Session tracking: persistent open sessions, sub-1s filtering, serialized pipeline
- Daily summary: upsert by date, no duplication
- Settings: API key hot-reload (no restart), permission status display, 30s defaults
- Insights: conversational chatbot interface (Perplexity-style)
- History: chart-based view with 7/14/30 day range selector
- Web view: consolidated browsers + websites with drill-down modal
- Inspector panel: removed (was redundant)
- Toolbar: cleaned up (no tracking toggle, no command bar icon)
- Sidebar: simplified (no sub-folders, direct Web item)

## Current Focus

### Core Functionality
- [ ] Verify Apps view shows tracked data correctly
- [ ] Verify Web view shows browser/website data correctly  
- [ ] Ensure all dashboard sections update in real-time
- [ ] Validate session durations are accurate

### Data Pipeline
- [ ] Investigate sessions with 0-second durations
- [ ] Ensure isSignificant flag is set correctly for all sessions
- [ ] Verify daily summary rebuild triggers consistently

## Future Features

### App Details
- [ ] Click on a top app in Today view to open detailed app usage view
- [ ] App detail view: session timeline, daily usage chart, category breakdown
- [ ] App comparison view: compare usage between two apps over time

### Web Details  
- [ ] Click on a browser to see websites visited in that browser
- [ ] Website detail view: visit frequency, time spent, category
- [ ] Website blocking/focus mode suggestions based on usage patterns

### Insights Enhancements
- [ ] Inline data widgets in chat responses (charts, tables)
- [ ] Proactive daily/weekly insight notifications
- [ ] Multi-model strategy: Haiku 4.5 for categorization, Sonnet 4.6 for analysis
- [ ] Conversation history persistence across app restarts

### History Enhancements
- [ ] Trend lines and moving averages
- [ ] Session density heatmap by hour/day
- [ ] Export history data as CSV/JSON
- [ ] Compare weeks/months side by side

### Dashboard Enhancements
- [ ] Activity density strip (hourly heatmap)
- [ ] Recent sessions timeline
- [ ] AI daily summary generation
- [ ] Top browsers and websites sections
- [ ] Recent trends snapshot (5-day view)

### Settings & Privacy
- [ ] Data retention auto-cleanup (90 day default)
- [ ] Granular export options (date range, categories, apps)
- [ ] App icon caching in database

### Technical
- [ ] Performance profiling on real workday data
- [ ] Idle detection edge cases (sleep/wake, lid close/open)
- [ ] Browser extension auto-reconnect resilience
- [ ] Safari Web Extension native messaging handler

## Notes / Risks

- AnthropicSwiftSDK may not compile in all environments — HTTP fallback retained
- Accessibility permission requires signed app or manual TCC grant in dev
- AI features require ANTHROPIC_API_KEY configured in Settings
- CaptureEngine uses Timer.scheduledTimer for flush — may need RunLoop.main.add
