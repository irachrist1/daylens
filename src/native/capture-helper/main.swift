// Daylens capture helper. Streams focus_events as newline-delimited JSON on
// stdout. Spawned by the Electron main process; see src/main/services/focusCapture.ts.
//
// Invariant: never emit a guessed URL or title with confidence=observed. When a
// read fails or permission is missing, the row records the failure (url=NULL,
// confidence=unknown), never a guess.

import Foundation
import AppKit
import ApplicationServices
import CoreServices

// MARK: clocks

@inline(__always) func monoNow() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
@inline(__always) func wallMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

// MARK: event emission

struct FocusEvent: Encodable {
  let ts_ms: Int
  let mono_ns: UInt64
  let event_type: String
  let app_bundle_id: String?
  let app_name: String?
  let pid: Int?
  let window_title: String?
  let url: String?
  let page_title: String?
  let source: String
  let confidence: String
  let platform: String
  let schema_ver: Int
}

let encoder = JSONEncoder()
let stdoutLock = NSLock()

func emit(_ ev: FocusEvent) {
  guard let data = try? encoder.encode(ev) else { return }
  stdoutLock.lock()
  defer { stdoutLock.unlock() }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
}

func logErr(_ s: String) {
  FileHandle.standardError.write(("[capture-helper] " + s + "\n").data(using: .utf8)!)
}

// MARK: browser detection

enum BrowserFamily: Equatable { case chromium, firefox, webkit }

func browserFamily(at appURL: URL) -> BrowserFamily {
  let root = appURL.appendingPathComponent("Contents")
  let resources = root.appendingPathComponent("Resources")
  if FileManager.default.fileExists(atPath: resources.appendingPathComponent("omni.ja").path)
      || FileManager.default.fileExists(atPath: resources.appendingPathComponent("browser/omni.ja").path) {
    return .firefox
  }

  let frameworks = root.appendingPathComponent("Frameworks")
  if let items = try? FileManager.default.contentsOfDirectory(atPath: frameworks.path),
     items.contains(where: {
       let lower = $0.lowercased()
       return lower.contains("framework.framework")
         || lower == "arccore.framework"
         || lower.contains("chromium")
         || lower.contains("electron")
     }) {
    return .chromium
  }
  return .webkit
}

func handlesWebURLs(_ bundle: Bundle) -> Bool {
  guard let types = bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] else {
    return false
  }
  let schemes = Set(types.flatMap { ($0["CFBundleURLSchemes"] as? [String]) ?? [] }.map { $0.lowercased() })
  return schemes.contains("http") && schemes.contains("https")
}

final class BrowserRegistry {
  private let lock = NSLock()
  private var applications: [String: (url: URL, family: BrowserFamily)] = [:]
  private var lastRefresh: TimeInterval = 0

  init() { refresh() }

  func refresh() {
    guard let webURL = URL(string: "https://daylens.invalid") else { return }
    let urls = NSWorkspace.shared.urlsForApplications(toOpen: webURL)
    var next: [String: (url: URL, family: BrowserFamily)] = [:]
    for url in urls {
      guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier, handlesWebURLs(bundle) else { continue }
      next[id] = (url, browserFamily(at: url))
    }
    lock.lock()
    applications = next
    lastRefresh = Date().timeIntervalSince1970
    lock.unlock()
  }

  func resolve(pid: pid_t, bundleId: String?) -> (url: URL, family: BrowserFamily)? {
    if let id = bundleId {
      lock.lock()
      let known = applications[id]
      let stale = Date().timeIntervalSince1970 - lastRefresh > 60
      lock.unlock()
      if let known { return known }
      if stale { refresh() }
    }

    guard let app = NSRunningApplication(processIdentifier: pid),
          let appURL = app.bundleURL,
          let bundle = Bundle(url: appURL),
          handlesWebURLs(bundle) else { return nil }
    let id = bundle.bundleIdentifier ?? bundleId ?? appURL.path
    let resolved = (url: appURL, family: browserFamily(at: appURL))
    lock.lock()
    applications[id] = resolved
    lock.unlock()
    return resolved
  }

  func snapshot() -> [(bundleId: String, url: URL, family: BrowserFamily)] {
    lock.lock()
    defer { lock.unlock() }
    return applications.map { (bundleId: $0.key, url: $0.value.url, family: $0.value.family) }
  }
}

let browserRegistry = BrowserRegistry()

struct BrowserDiscoveryRecord: Encodable {
  let name: String
  let bundleId: String
  let appPath: String
  let family: String
}

func emitBrowserDiscovery() -> Int32 {
  let records = browserRegistry.snapshot().compactMap { entry -> BrowserDiscoveryRecord? in
    guard let bundle = Bundle(url: entry.url) else { return nil }
    let name = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
      ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
      ?? entry.url.deletingPathExtension().lastPathComponent
    let family: String
    switch entry.family {
    case .chromium: family = "chromium"
    case .firefox: family = "firefox"
    case .webkit: family = "webkit"
    }
    return BrowserDiscoveryRecord(
      name: name,
      bundleId: entry.bundleId,
      appPath: entry.url.path,
      family: family)
  }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  guard let data = try? encoder.encode(records) else { return 1 }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
  return 0
}

func isBrowser(_ pid: pid_t, _ bundle: String?) -> Bool {
  return browserRegistry.resolve(pid: pid, bundleId: bundle) != nil
}

func isFirefox(_ pid: pid_t, _ bundle: String?) -> Bool {
  return browserRegistry.resolve(pid: pid, bundleId: bundle)?.family == .firefox
}

func isSafari(_ pid: pid_t, _ bundle: String?) -> Bool {
  return browserRegistry.resolve(pid: pid, bundleId: bundle)?.family == .webkit
}

let internalSchemes = ["chrome://", "chrome-untrusted://", "about:", "safari-resource://"]
func isInternalScheme(_ url: String) -> Bool {
  let u = url.lowercased()
  return internalSchemes.contains { u.hasPrefix($0) }
}

// MARK: frontmost snapshot (written on main, read on tab queue)

final class Frontmost {
  private let lock = NSLock()
  private var _pid: pid_t = 0
  private var _name: String?
  private var _bundle: String?
  private var _title: String?

  func setApp(pid: pid_t, name: String?, bundle: String?) {
    lock.lock(); _pid = pid; _name = name; _bundle = bundle; lock.unlock()
  }
  func setTitle(_ t: String?) -> Bool {
    lock.lock()
    let changed = _title != t
    _title = t
    lock.unlock()
    return changed
  }
  func get() -> (pid: pid_t, name: String?, bundle: String?, title: String?) {
    lock.lock(); defer { lock.unlock() }
    return (_pid, _name, _bundle, _title)
  }
}
let frontmost = Frontmost()

// MARK: accessibility focused-window title

func axFocusedWindowTitle(pid: pid_t) -> String? {
  let appElem = AXUIElementCreateApplication(pid)
  var windowRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(appElem, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
        let win = windowRef else { return nil }
  var titleRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &titleRef) == .success else {
    return nil
  }
  let t = titleRef as? String
  // Empty in full-screen is a successful read of a genuinely empty title -> NULL.
  return (t?.isEmpty ?? true) ? nil : t
}

// MARK: automation permission

let wildClass = AEEventClass(0x2A2A2A2A) // '****'
let wildID = AEEventID(0x2A2A2A2A)
enum Automation: Equatable { case authorized, notDetermined, denied, notRunning, other(Int) }

func automationStatus(bundleId: String) -> Automation {
  let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
  guard let desc = target.aeDesc else { return .other(-1) }
  switch AEDeterminePermissionToAutomateTarget(desc, wildClass, wildID, false) {
  case 0: return .authorized
  case -1743: return .denied
  case -1744: return .notDetermined
  case -600: return .notRunning
  case let s: return .other(Int(s))
  }
}

// MARK: tab reader (compiled AppleScript on a dedicated exec queue, 500ms guard)

enum TabRead {
  case ok(url: String, title: String?)
  case internalScheme(url: String)
  case missingValue
  case unsupported
  case timeout
  case failure
}

final class TabReader {
  private let execQueue = DispatchQueue(label: "com.daylens.capture.tab-exec", qos: .utility)
  private var scripts: [String: NSAppleScript] = [:]

  private func script(appName: String, safari: Bool) -> NSAppleScript? {
    if let s = scripts[appName] { return s }
    let prop = safari ? "current tab" : "active tab"
    let titleKey = safari ? "name" : "title"
    let src = """
    tell application "\(appName)"
      if (count of windows) is 0 then return ""
      return (URL of \(prop) of front window) & linefeed & (\(titleKey) of \(prop) of front window)
    end tell
    """
    guard let s = NSAppleScript(source: src) else { return nil }
    var err: NSDictionary?
    s.compileAndReturnError(&err)
    if err != nil { return nil }
    scripts[appName] = s
    return s
  }

  func read(appName: String, safari: Bool, timeoutMs: Int) -> TabRead {
    guard let s = script(appName: appName, safari: safari) else { return .failure }
    final class Box { var value: TabRead = .failure }
    let box = Box()
    let sem = DispatchSemaphore(value: 0)
    execQueue.async {
      var err: NSDictionary?
      let out = s.executeAndReturnError(&err)
      box.value = err != nil ? .failure : TabReader.parse(out.stringValue ?? "")
      sem.signal()
    }
    if sem.wait(timeout: .now() + .milliseconds(timeoutMs)) == .timedOut { return .timeout }
    return box.value
  }

  static func parse(_ raw: String) -> TabRead {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return .failure } // no windows / nothing returned
    let parts = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    let url = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
    let rawTitle = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil
    if url == "missing value" || url.isEmpty { return .missingValue }
    if isInternalScheme(url) { return .internalScheme(url: url) }
    let title = (rawTitle?.isEmpty ?? true) || rawTitle == "missing value" ? nil : rawTitle
    return .ok(url: url, title: title)
  }
}
let reader = TabReader()

// MARK: dwell state (touched only on the tab queue)

let tabQueue = DispatchQueue(label: "com.daylens.capture.tab", qos: .utility)

struct Dwell {
  var key: String           // url | "__browser_internal__"
  var url: String?
  var lastObservedMono: UInt64
  var lastObservedTs: Int
  var lastSampleMono: UInt64
  var identicalCount: Int
}

var pollEpoch = 0
var dwell: Dwell?
var uncertain: (failCount: Int, sinceMono: UInt64)?
var permCache: [String: (Automation, UInt64)] = [:]

let HEARTBEAT_NS: UInt64 = 10_000_000_000
let UNCERTAIN_MAX_NS: UInt64 = 10_000_000_000
let BACKOFF_AFTER_SAMPLES = 5
let internalKey = "__browser_internal__"
let FOREGROUND_HEARTBEAT_NS: UInt64 = 10_000_000_000
var lastForegroundEmitMono: UInt64 = 0

func tabFields(eventType: String, url: String?, pageTitle: String?, confidence: String,
               mono: UInt64, ts: Int) {
  let f = frontmost.get()
  emit(FocusEvent(
    ts_ms: ts, mono_ns: mono, event_type: eventType,
    app_bundle_id: f.bundle, app_name: f.name, pid: Int(f.pid),
    window_title: f.title, url: url, page_title: pageTitle,
    source: "apple_events_tab", confidence: confidence,
    platform: "darwin", schema_ver: 1))
}

func permission(_ bundle: String) -> Automation {
  let now = monoNow()
  if let (st, at) = permCache[bundle] {
    let cacheable = (st == .authorized || st == .denied)
    if cacheable && now - at < 60_000_000_000 { return st }
  }
  let st = automationStatus(bundleId: bundle)
  permCache[bundle] = (st, now)
  return st
}

func onObserved(key: String, url: String, title: String?, mono: UInt64, ts: Int) {
  let wasUncertain = uncertain != nil
  uncertain = nil
  if var d = dwell {
    if d.key == key {
      d.lastObservedMono = mono; d.lastObservedTs = ts; d.identicalCount += 1
      if mono - d.lastSampleMono >= HEARTBEAT_NS {
        tabFields(eventType: "tab_sampled", url: url, pageTitle: title, confidence: "observed", mono: mono, ts: ts)
        d.lastSampleMono = mono
      }
      dwell = d
      return
    }
    if wasUncertain {
      // Cap the prior dwell at the last good read; don't credit the uncertain gap.
      tabFields(eventType: "tab_changed", url: nil, pageTitle: nil, confidence: "unknown",
                mono: d.lastObservedMono, ts: d.lastObservedTs)
    }
  }
  tabFields(eventType: "tab_changed", url: url, pageTitle: title, confidence: "observed", mono: mono, ts: ts)
  dwell = Dwell(key: key, url: url, lastObservedMono: mono, lastObservedTs: ts, lastSampleMono: mono, identicalCount: 0)
}

func onTabReadFailure(mono: UInt64, ts: Int) {
  tabFields(eventType: "tab_changed", url: nil, pageTitle: nil, confidence: "unknown", mono: mono, ts: ts)
  if uncertain == nil {
    uncertain = (1, mono)
    return
  }
  uncertain!.failCount += 1
  if uncertain!.failCount >= 3 || mono - uncertain!.sinceMono > UNCERTAIN_MAX_NS {
    dwell = nil
    uncertain = nil
  }
}

func handleTabRead(_ read: TabRead, mono: UInt64, ts: Int) {
  switch read {
  case .ok(let url, let title):
    onObserved(key: url, url: url, title: title, mono: mono, ts: ts)
  case .internalScheme(let url):
    onObserved(key: internalKey, url: url, title: nil, mono: mono, ts: ts)
  case .missingValue, .unsupported, .timeout, .failure:
    onTabReadFailure(mono: mono, ts: ts)
  }
}

func sampleTime(mono: UInt64?, ts: Int?) -> (mono: UInt64, ts: Int) {
  return (mono ?? monoNow(), ts ?? wallMs())
}

func handleFrontmostBrowserSample(permissionOverride: Automation? = nil, tabReadOverride: TabRead? = nil,
                                  browserFamilyOverride: BrowserFamily? = nil,
                                  mono: UInt64? = nil, ts: Int? = nil) {
  let f = frontmost.get()
  guard let bundle = f.bundle,
        let family = browserFamilyOverride ?? browserRegistry.resolve(pid: f.pid, bundleId: f.bundle)?.family else { return }

  if family == .firefox {
    let t = sampleTime(mono: mono, ts: ts)
    onTabReadFailure(mono: t.mono, ts: t.ts)
    return
  }

  switch permissionOverride ?? permission(bundle) {
  case .authorized:
    let read = tabReadOverride ?? reader.read(appName: f.name ?? "", safari: family == .webkit, timeoutMs: 500)
    let t = sampleTime(mono: mono, ts: ts)
    handleTabRead(read, mono: t.mono, ts: t.ts)
  case .notDetermined, .denied, .other:
    let t = sampleTime(mono: mono, ts: ts)
    onTabReadFailure(mono: t.mono, ts: t.ts)
  case .notRunning:
    break
  }
}

func startPolling() {
  pollEpoch += 1
  dwell = nil
  uncertain = nil
  pollTick(pollEpoch)
}

func stopPolling() {
  pollEpoch += 1
  dwell = nil
  uncertain = nil
}

func pollTick(_ epoch: Int) {
  guard epoch == pollEpoch else { return }
  let f = frontmost.get()
  guard let bundle = f.bundle, isBrowser(f.pid, f.bundle) else { return }
  _ = bundle

  handleFrontmostBrowserSample()

  let backoff = (dwell?.identicalCount ?? 0) >= BACKOFF_AFTER_SAMPLES
  tabQueue.asyncAfter(deadline: .now() + (backoff ? 3.0 : 1.0)) { pollTick(epoch) }
}

// MARK: foreground events (main thread)

func emitForeground(_ type: String, pid: pid_t, name: String?, bundle: String?, title: String?) {
  let mono = monoNow()
  lastForegroundEmitMono = mono
  emit(FocusEvent(
    ts_ms: wallMs(), mono_ns: mono, event_type: type,
    app_bundle_id: bundle, app_name: name, pid: Int(pid),
    window_title: title, url: nil, page_title: nil,
    source: "nsworkspace_event", confidence: "observed",
    platform: "darwin", schema_ver: 1))
}

func emitSystem(_ type: String) {
  let f = frontmost.get()
  emit(FocusEvent(
    ts_ms: wallMs(), mono_ns: monoNow(), event_type: type,
    app_bundle_id: nil, app_name: nil, pid: nil,
    window_title: nil, url: nil, page_title: nil,
    source: "nsworkspace_event", confidence: "observed",
    platform: "darwin", schema_ver: 1))
  _ = f
}

func adoptFrontmost(_ a: NSRunningApplication?) {
  let pid = a?.processIdentifier ?? 0
  let name = a?.localizedName
  let bundle = a?.bundleIdentifier
  let title = axFocusedWindowTitle(pid: pid)
  frontmost.setApp(pid: pid, name: name, bundle: bundle)
  _ = frontmost.setTitle(title)
}
func runNeverGuessProbe(_ mode: String) -> Int32 {
  let mono = monoNow()
  let ts = wallMs()
  let browserName = mode == "unsupported_browser" ? "Firefox" : "Google Chrome"
  let bundle = mode == "unsupported_browser" ? "org.mozilla.firefox" : "com.google.Chrome"
  frontmost.setApp(pid: 123, name: browserName, bundle: bundle)
  _ = frontmost.setTitle("Stale window title")
  dwell = Dwell(
    key: "https://stale.example.test/previous",
    url: "https://stale.example.test/previous",
    lastObservedMono: mono - 1_000_000_000,
    lastObservedTs: ts - 1000,
    lastSampleMono: mono - 1_000_000_000,
    identicalCount: 1)

  switch mode {
  case "permission_denied":
    handleFrontmostBrowserSample(permissionOverride: .denied, browserFamilyOverride: .chromium, mono: mono, ts: ts)
  case "permission_not_determined":
    handleFrontmostBrowserSample(permissionOverride: .notDetermined, browserFamilyOverride: .chromium, mono: mono, ts: ts)
  case "timeout":
    handleFrontmostBrowserSample(
      permissionOverride: .authorized, tabReadOverride: .timeout,
      browserFamilyOverride: .chromium, mono: mono, ts: ts)
  case "missing_value":
    handleFrontmostBrowserSample(
      permissionOverride: .authorized, tabReadOverride: .missingValue,
      browserFamilyOverride: .chromium, mono: mono, ts: ts)
  case "unsupported_browser":
    handleFrontmostBrowserSample(
      permissionOverride: .authorized,
      tabReadOverride: .unsupported,
      browserFamilyOverride: .firefox,
      mono: mono,
      ts: ts)
  default:
    logErr("unknown never-guess probe mode: \(mode)")
    return 64
  }

  return 0
}

if ProcessInfo.processInfo.environment["DAYLENS_CAPTURE_HELPER_BROWSER_DISCOVERY"] == "1" {
  exit(emitBrowserDiscovery())
}

if let mode = ProcessInfo.processInfo.environment["DAYLENS_CAPTURE_HELPER_NEVER_GUESS_PROBE"] {
  exit(runNeverGuessProbe(mode))
}

// MARK: run loop

let nsApp = NSApplication.shared
nsApp.setActivationPolicy(.accessory)
signal(SIGPIPE, SIG_IGN)

if !AXIsProcessTrusted() {
  logErr("accessibility not trusted; window titles will be NULL until granted")
}

let wsNc = NSWorkspace.shared.notificationCenter

wsNc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
  let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  adoptFrontmost(a)
  let f = frontmost.get()
  emitForeground("app_activated", pid: f.pid, name: f.name, bundle: f.bundle, title: f.title)
  let browser = isBrowser(f.pid, f.bundle)
  let bundle = f.bundle
  tabQueue.async {
    if let b = bundle { permCache[b] = nil } // re-check permission on activation
    if browser { startPolling() } else { stopPolling() }
  }
}

wsNc.addObserver(forName: NSWorkspace.didDeactivateApplicationNotification, object: nil, queue: .main) { note in
  let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  emitForeground("app_deactivated", pid: a?.processIdentifier ?? 0,
                 name: a?.localizedName, bundle: a?.bundleIdentifier, title: nil)
  if isBrowser(a?.processIdentifier ?? 0, a?.bundleIdentifier) {
    tabQueue.async { stopPolling() }
  }
}

wsNc.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
  adoptFrontmost(NSWorkspace.shared.frontmostApplication)
  let f = frontmost.get()
  emitForeground("space_changed", pid: f.pid, name: f.name, bundle: f.bundle, title: f.title)
}

func pollFocusedWindowTitle() {
  let f = frontmost.get()
  if f.pid > 0 {
    let title = axFocusedWindowTitle(pid: f.pid)
    let shouldHeartbeat = monoNow() - lastForegroundEmitMono >= FOREGROUND_HEARTBEAT_NS
    if frontmost.setTitle(title) || shouldHeartbeat {
      let updated = frontmost.get()
      emitForeground(
        "window_changed",
        pid: updated.pid,
        name: updated.name,
        bundle: updated.bundle,
        title: updated.title)
    }
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { pollFocusedWindowTitle() }
}

wsNc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in
  emitSystem("sleep"); tabQueue.async { stopPolling() }
}
wsNc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
  emitSystem("wake")
}

let dnc = DistributedNotificationCenter.default()
dnc.addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
  emitSystem("lock"); tabQueue.async { stopPolling() }
}
dnc.addObserver(forName: Notification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
  emitSystem("unlock")
}

// Exit cleanly when the parent process closes our stdin pipe.
DispatchQueue.global(qos: .utility).async {
  let stdin = FileHandle.standardInput
  while true {
    let data = stdin.availableData
    if data.isEmpty { exit(0) }
    if String(data: data, encoding: .utf8)?.contains("shutdown") == true { exit(0) }
  }
}

// Seed state from whatever is already frontmost (no activation fires at launch).
adoptFrontmost(NSWorkspace.shared.frontmostApplication)
let seed = frontmost.get()
emitForeground("app_activated", pid: seed.pid, name: seed.name, bundle: seed.bundle, title: seed.title)
if isBrowser(seed.pid, seed.bundle) {
  tabQueue.async { startPolling() }
}
pollFocusedWindowTitle()

logErr("started (ax_trusted=\(AXIsProcessTrusted()))")
nsApp.run()
