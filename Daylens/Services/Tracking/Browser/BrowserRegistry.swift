import AppKit
import OSLog

/// Runtime browser detection and capability mapping.
///
/// Apps are classified into three tiers:
/// - **Primary browsers**: General-purpose web browsers (Safari, Chrome, Arc, Zen, etc.)
/// - **Hybrid apps**: AI-primary apps with real browser capability and history evidence
///   (Dia, Atlas). Categorized by their primary function but their browser history is captured.
/// - **Excluded**: Apps that register http:// schemes but are not browsers (Claude, ChatGPT desktop, etc.)
final class BrowserRegistry {
    static let shared = BrowserRegistry()

    private let logger = Logger(subsystem: "com.daylens.app", category: "BrowserRegistry")
    private let stateLock = NSLock()
    private var cachedState: RegistryState?

    /// All known browser-capable definitions, keyed by bundle ID.
    private let knownDefinitions: [String: BrowserDefinition] = {
        var map: [String: BrowserDefinition] = [:]
        for def in BrowserDefinition.allPrimary + BrowserDefinition.allHybrid {
            map[def.bundleID] = def
        }
        return map
    }()

    /// Bundle IDs that register http:// but are NOT browser-capable.
    /// These never get browser history reading or URL extraction.
    static let excludedBundleIDs: Set<String> = [
        "com.blackboxai.desktopapp",     // BLACKBOXAI — AI code assistant, no history DB
        "com.anthropic.claudefordesktop",// Claude — AI assistant, no history DB
        "com.openai.chat",              // ChatGPT desktop — AI assistant, no history DB
        "ai.perplexity.mac",            // Perplexity desktop — AI search, no history DB
        "com.cmuxterm.app",             // cmux — terminal app, not a browser
    ]

    /// Cached detection results, populated on first access.
    var installedBrowsers: [InstalledBrowser] { registryState().installedBrowsers }

    /// Fast lookup: bundle IDs with any browser capability (primary OR hybrid).
    var browserCapableBundleIDs: Set<String> { registryState().browserCapableBundleIDs }

    /// Only primary browsers (not hybrids). Used for Constants.knownBrowserBundleIDs.
    var primaryBrowserBundleIDs: Set<String> { registryState().primaryBrowserBundleIDs }

    /// Check if a bundle ID has browser capability (primary or hybrid with evidence).
    func isBrowserCapable(_ bundleID: String) -> Bool {
        browserCapableBundleIDs.contains(bundleID)
    }

    /// Check if a bundle ID is a primary (general-purpose) browser.
    func isPrimaryBrowser(_ bundleID: String) -> Bool {
        primaryBrowserBundleIDs.contains(bundleID)
    }

    /// Get the installed browser info for a bundle ID.
    func browser(for bundleID: String) -> InstalledBrowser? {
        installedBrowsers.first { $0.definition.bundleID == bundleID }
    }

    /// Human-readable name for a browser-capable bundle ID.
    func browserName(for bundleID: String) -> String? {
        knownDefinitions[bundleID]?.displayName
    }

    /// Refresh the installed browser list (e.g., after app install/uninstall).
    func refresh() {
        let refreshedState = makeRegistryState()
        stateLock.lock()
        cachedState = refreshedState
        stateLock.unlock()
    }

    // MARK: - Detection

    private func detectAll() -> [InstalledBrowser] {
        let allDefinitions = BrowserDefinition.allPrimary + BrowserDefinition.allHybrid
        var results: [InstalledBrowser] = []
        let homeDir = FileManager.default.homeDirectoryForCurrentUser.path

        for definition in allDefinitions {
            guard let appURL = NSWorkspace.shared.urlForApplication(
                withBundleIdentifier: definition.bundleID
            ) else { continue }

            let historyAvailable = checkHistoryAvailability(definition: definition, homeDir: homeDir)

            // For hybrid apps, only include if browser history evidence exists on disk.
            // No evidence → don't treat as browser-capable.
            if definition.role == .hybrid && !historyAvailable {
                logger.info("Hybrid app \(definition.displayName, privacy: .public) installed but no history evidence — skipping browser capability")
                continue
            }

            let installed = InstalledBrowser(
                definition: definition,
                appURL: appURL,
                historyAvailable: historyAvailable
            )
            results.append(installed)
            logger.info("Detected \(definition.role.rawValue, privacy: .public) browser: \(definition.displayName, privacy: .public) (\(definition.bundleID, privacy: .public)) history=\(historyAvailable, privacy: .public)")
        }

        return results
    }

    private func registryState() -> RegistryState {
        stateLock.lock()
        if let cachedState {
            stateLock.unlock()
            return cachedState
        }
        stateLock.unlock()

        let detectedState = makeRegistryState()

        stateLock.lock()
        defer { stateLock.unlock() }
        if let cachedState {
            return cachedState
        }
        cachedState = detectedState
        return detectedState
    }

    private func makeRegistryState() -> RegistryState {
        let installedBrowsers = detectAll()
        return RegistryState(
            installedBrowsers: installedBrowsers,
            browserCapableBundleIDs: Set(installedBrowsers.map(\.definition.bundleID)),
            primaryBrowserBundleIDs: Set(
                installedBrowsers
                    .filter { $0.definition.role == .primary }
                    .map(\.definition.bundleID)
            )
        )
    }

    private func checkHistoryAvailability(definition: BrowserDefinition, homeDir: String) -> Bool {
        switch definition.engine {
        case .safari:
            let path = (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
            return FileManager.default.fileExists(atPath: path)
        case .chromium:
            let path = (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
            if FileManager.default.fileExists(atPath: path) {
                return true
            }
            // Check for profile directories
            let components = definition.historyRelativePath.components(separatedBy: "/")
            if components.count >= 3 {
                let userDataRelative = components.dropLast(2).joined(separator: "/")
                let userDataPath = (homeDir as NSString).appendingPathComponent(userDataRelative)
                return FileManager.default.fileExists(atPath: userDataPath)
            }
            return false
        case .firefox:
            let profilesDir = (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
            return FileManager.default.fileExists(atPath: profilesDir)
        }
    }
}

private struct RegistryState {
    let installedBrowsers: [InstalledBrowser]
    let browserCapableBundleIDs: Set<String>
    let primaryBrowserBundleIDs: Set<String>
}

// MARK: - Browser Definition

/// Static definition of a browser-capable app's identity and capabilities.
struct BrowserDefinition {
    let bundleID: String
    let displayName: String
    let engine: BrowserEngine
    let role: BrowserRole
    /// Relative path from home directory to history database (or profiles directory for Firefox-based).
    let historyRelativePath: String
    let supportsAppleScript: Bool

    /// The app's primary semantic category (used for AppCategory classification).
    /// For primary browsers this is .browsing. For hybrids it reflects their real purpose.
    let primaryCategory: AppCategory

    enum BrowserEngine: String {
        case chromium
        case firefox
        case safari
    }

    /// Whether this is a general-purpose browser or an app with browser capability.
    enum BrowserRole: String {
        /// General-purpose web browser — browsing is the primary function.
        case primary
        /// AI tool or other app that has real, evidence-based browser capability.
        /// History is captured but the app's primary category is not .browsing.
        case hybrid
    }

    // MARK: - Primary Browsers

    static let allPrimary: [BrowserDefinition] = [
        BrowserDefinition(
            bundleID: "com.apple.Safari",
            displayName: "Safari",
            engine: .safari, role: .primary,
            historyRelativePath: "Library/Safari/History.db",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "com.google.Chrome",
            displayName: "Chrome",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Google/Chrome/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "company.thebrowser.Browser",
            displayName: "Arc",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Arc/User Data/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "com.brave.Browser",
            displayName: "Brave",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/BraveSoftware/Brave-Browser/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "com.microsoft.edgemac",
            displayName: "Edge",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Microsoft Edge/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "org.mozilla.firefox",
            displayName: "Firefox",
            engine: .firefox, role: .primary,
            historyRelativePath: "Library/Application Support/Firefox/Profiles",
            supportsAppleScript: false,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "app.zen-browser.zen",
            displayName: "Zen",
            engine: .firefox, role: .primary,
            historyRelativePath: "Library/Application Support/zen/Profiles",
            supportsAppleScript: false,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "ai.perplexity.comet",
            displayName: "Comet",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Comet/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "com.operasoftware.Opera",
            displayName: "Opera",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/com.operasoftware.Opera/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "com.vivaldi.Vivaldi",
            displayName: "Vivaldi",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Vivaldi/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
        BrowserDefinition(
            bundleID: "org.chromium.Chromium",
            displayName: "Chromium",
            engine: .chromium, role: .primary,
            historyRelativePath: "Library/Application Support/Chromium/Default/History",
            supportsAppleScript: true,
            primaryCategory: .browsing
        ),
    ]

    // MARK: - Hybrid Apps (AI-primary with real browser capability)

    static let allHybrid: [BrowserDefinition] = [
        // Dia — The Browser Company's AI browser.
        // Chromium-based, has User Data/Default/History.
        // Primary purpose is AI assistance, but it has full browsing capability.
        BrowserDefinition(
            bundleID: "company.thebrowser.dia",
            displayName: "Dia",
            engine: .chromium, role: .hybrid,
            historyRelativePath: "Library/Application Support/Dia/User Data/Default/History",
            supportsAppleScript: true,
            primaryCategory: .aiTools
        ),
        // Atlas — OpenAI's ChatGPT browser.
        // Chromium-based, has browser-data/host/Default/History.
        // Primary purpose is AI-powered browsing.
        BrowserDefinition(
            bundleID: "com.openai.atlas",
            displayName: "Atlas",
            engine: .chromium, role: .hybrid,
            historyRelativePath: "Library/Application Support/com.openai.atlas/browser-data/host/Default/History",
            supportsAppleScript: false,
            primaryCategory: .aiTools
        ),
    ]

    /// All definitions (primary + hybrid) — used by BrowserHistoryReader to iterate.
    static var all: [BrowserDefinition] {
        allPrimary + allHybrid
    }
}

// MARK: - Installed Browser

/// A browser-capable app that was detected as installed on this machine with evidence.
struct InstalledBrowser {
    let definition: BrowserDefinition
    let appURL: URL
    let historyAvailable: Bool

    var isPrimary: Bool { definition.role == .primary }
    var isHybrid: Bool { definition.role == .hybrid }
}
