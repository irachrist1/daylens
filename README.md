# Daylens

### Your digital life, made searchable and retrievable on demand.

---

Daylens is a **local-first personal memory system** for your laptop (macOS, Windows, and Linux). It quietly logs your foreground app sessions, browser history, focus sessions, and active work blocks, turning your raw behavioral history into a rich, structured database. 

With a grounded **AI chat interface** and a built-in **Model Context Protocol (MCP) server**, Daylens allows you, and the AI tools you already use (like Cursor, Claude Code, or Claude Desktop), to ask grounded questions about your digital past and retrieve exact context instantly.

---

## 🌟 Hackathon Focus: Track 3 — Economic Empowerment & Education

Students and professionals lose an immense amount of the information they consume because there is no reliable way to search their personal digital history. When you study a complex course, read documentation, or work across multiple files, your context is highly fragmented:
- *“Where was that YouTube video on gradient descent I watched two weeks ago?”*
- *“Which article did I read on prompt caching last Friday?”*
- *“What client problems did I solve last Tuesday morning?”*

Daylens bridges this gap by acting as a **personal learning and context retriever**. It empowers users to compounding the value of every hour spent studying or working by ensuring their personal knowledge base is never lost, remains entirely private, and is instantly searchable.

---

## 🚀 Key Features

*   **📅 Local-First Timeline Reconstruction**: Automatically groups fragmented app sessions and browser visits into coherent, named work blocks in real time. Inspect your day at a glance.
*   **🧠 Grounded AI Chat Surface**: Ask natural language questions about your day (*"What did I study about neural networks this week?"*) and get detailed, synthesized answers backed by exact time and domain citations.
*   **⚡ Background Content Indexer**: Enriches browser history from educational and research platforms (Coursera, YouTube, arXiv, documentation, blogs) by fetching page contents and generating topic-tagged AI summaries. It answers based on *what you learned*, not just how long the browser was open.
*   **🔌 Model Context Protocol (MCP) Server**: A built-in, opt-in MCP server that exposes your local work timeline to external AI tools. You can query your activity directly within Cursor or Claude Desktop.
*   **🔒 Privacy by Design**: **100% of your data stays on your machine.** Daylens stores all activity in a local SQLite database. No third-party servers, no remote tracking, and no cloud-surveillance risk. Self-knowledge, fully owned by you.

---

## 🛠️ Substantive AI Implementation (Not a Wrapper!)

Daylens does what standard web-based AI assistants cannot:
1.  **It Has Your Data**: Web-based tools start from zero. Daylens holds a continuous, structured SQLite behavioral timeline, feeding grounded context to the AI model.
2.  **Context-Enriched Ingestion**: The background content indexer fetches visited pages, uses Claude to generate 2-sentence topic-tagged summaries, and stores them in `content_summaries` for high-precision semantic search.
3.  **Advanced Hybrid Query Router**: Features a deterministic routing harness that handles common questions (like exact duration matches) instantly, falling back to a multi-model tool-calling agent only when complex synthesis is required.

---

## 🏗️ Tech Stack

*   **Core**: Electron, TypeScript
*   **Frontend**: React 19, TailwindCSS v4, Lucide React, Recharts
*   **Data & System Layer**: SQLite (`better-sqlite3`), macOS Swift native capture probe, `keytar`
*   **Integration**: Model Context Protocol (MCP), Sentry, PostHog

---

## 💻 Development & Build Commands

### Setup
```bash
npm install                  # Install dependencies and compile native bindings
```

### Dev & Test
```bash
npm start                    # Run Daylens in Electron dev mode
npm run typecheck            # TypeScript compiler check
npm run test:ai-chat         # Run the main AI/chat regression suite
npm run ai:bench             # Run the AI router benchmark suite
```

### Build & Package
```bash
npm run build:all            # Build main, preload, renderer, MCP, and capture-helper
npm run dist:mac             # Package macOS DMG and ZIP artifacts
npm run dist:win             # Package Windows installer
npm run dist:linux           # Package Linux AppImage, .deb, and .rpm
```

---

## 🔐 Security & Peace of Mind

*   **Zero-Cloud Storage**: No data is sent to the cloud by default.
*   **Transparency**: View exactly what is captured in the Timeline and Apps views. Delete or filter any activity instantly in **Settings**.
*   **Explicit MCP Authorization**: The local MCP server is off by default and can only be enabled via toggle in Settings.
