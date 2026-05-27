// Daylens capture probe — measures the three broken things on THIS machine.
//
//   1. Full-screen drops:   logs frontmost app + focused-window title from four
//                           different APIs side by side, every second, plus the
//                           NSWorkspace activation / active-space-change events,
//                           so we can see which APIs survive full-screen + Spaces.
//   2. Per-tab time:        when a browser is frontmost, reads the active tab via
//                           osascript and records the URL, latency, and any error.
//   3. Silent permission:   reports Accessibility trust and per-app Automation
//                           (Apple Events) authorization, and captures osascript
//                           stderr so we can SEE a silent denial instead of
//                           treating empty output as "no data".
//
// Run:   swift probes/capture-probe.swift
// Stop:  Ctrl-C. A log is also written to ~/Desktop/daylens-probe-<stamp>.log
//
// While it runs, do this, slowly, pausing ~3s on each step:
//   a) Switch between two normal windowed apps.
//   b) Open a browser, switch between 3-4 tabs.            <- watch tab + url
//   c) Put that browser FULL SCREEN, switch tabs again.    <- the key test
//   d) Open a second app full screen, swipe between them.  <- Spaces test
//   e) Swipe back to the desktop Space.

import Foundation
import AppKit
import ApplicationServices
import CoreServices

// ── logging ────────────────────────────────────────────────────────────────
let stamp: String = {
  let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; return f.string(from: Date())
}()
let logURL = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent("Desktop/daylens-probe-\(stamp).log")
FileManager.default.createFile(atPath: logURL.path, contents: nil)
let logHandle = try? FileHandle(forWritingTo: logURL)
let tf: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f }()
func log(_ s: String) {
  let line = "[\(tf.string(from: Date()))] \(s)\n"
  FileHandle.standardOutput.write(line.data(using: .utf8)!)
  logHandle?.write(line.data(using: .utf8)!)
}

// ── browser detection + tab scripting ────────────────────────────────────────
let browserKeywords = ["safari","chrome","chromium","arc","dia","comet","brave","edge","opera","vivaldi","firefox","browser"]
func isBrowser(_ name: String?, _ bundle: String?) -> Bool {
  let hay = ((name ?? "") + " " + (bundle ?? "")).lowercased()
  return browserKeywords.contains { hay.contains($0) }
}
func isFirefox(_ name: String?) -> Bool { (name ?? "").lowercased().contains("firefox") }
func isSafari(_ name: String?) -> Bool { (name ?? "").lowercased().contains("safari") }

func tabScript(appName: String, safari: Bool) -> String {
  let prop = safari ? "current tab" : "active tab"
  let titleKey = safari ? "name" : "title"
  return """
  tell application "\(appName)"
    if (count of windows) is 0 then return ""
    return (URL of \(prop) of front window) & linefeed & (\(titleKey) of \(prop) of front window)
  end tell
  """
}

func runOsa(_ script: String) -> (out: String, err: String, code: Int32, ms: Int) {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  p.arguments = ["-e", script]
  let outPipe = Pipe(); let errPipe = Pipe()
  p.standardOutput = outPipe; p.standardError = errPipe
  let start = Date()
  do { try p.run() } catch { return ("", "spawn-error: \(error)", -1, 0) }
  p.waitUntilExit()
  let ms = Int(Date().timeIntervalSince(start) * 1000)
  let out = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return (out.trimmingCharacters(in: .whitespacesAndNewlines),
          err.trimmingCharacters(in: .whitespacesAndNewlines),
          p.terminationStatus, ms)
}

// ── Accessibility focused-window title ───────────────────────────────────────
func axFocusedWindowTitle(pid: pid_t) -> (status: String, title: String?) {
  let appElem = AXUIElementCreateApplication(pid)
  var windowRef: CFTypeRef?
  let e = AXUIElementCopyAttributeValue(appElem, kAXFocusedWindowAttribute as CFString, &windowRef)
  if e != .success { return ("AXerr(\(e.rawValue))", nil) }
  guard let win = windowRef else { return ("noFocusedWindow", nil) }
  var titleRef: CFTypeRef?
  let te = AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &titleRef)
  if te != .success { return ("AXtitleErr(\(te.rawValue))", nil) }
  return ("ok", titleRef as? String)
}

// ── CGWindowList frontmost on-screen window ──────────────────────────────────
func cgFrontWindow(pid: pid_t) -> (count: Int, found: Bool, name: String?) {
  let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    return (0, false, nil)
  }
  for w in list {
    let owner = (w[kCGWindowOwnerPID as String] as? Int) ?? -1
    let layer = (w[kCGWindowLayer as String] as? Int) ?? -99
    if owner == Int(pid) && layer == 0 {
      return (list.count, true, w[kCGWindowName as String] as? String)
    }
  }
  return (list.count, false, nil)
}

// ── Apple Events (Automation) authorization, no prompt ───────────────────────
let wildClass = AEEventClass(0x2A2A2A2A) // '****'
let wildID = AEEventID(0x2A2A2A2A)
func automationStatus(bundleId: String) -> String {
  let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
  guard let desc = target.aeDesc else { return "noDesc" }
  let s = AEDeterminePermissionToAutomateTarget(desc, wildClass, wildID, false)
  switch s {
  case 0:      return "authorized(0)"
  case -1743:  return "DENIED(-1743)"
  case -1744:  return "notDetermined(-1744)"
  case -600:   return "appNotRunning(-600)"
  default:     return "status(\(s))"
  }
}

// ── startup report ───────────────────────────────────────────────────────────
log("=== Daylens capture probe ===")
log("log file: \(logURL.path)")
let axTrusted = AXIsProcessTrusted()
log("Accessibility trusted (this process): \(axTrusted)")
if !axTrusted {
  log("Accessibility NOT trusted — focused-window titles will fail. Prompting…")
  let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
  _ = AXIsProcessTrustedWithOptions(opts)
  log("Grant the prompting app (your terminal) Accessibility, then restart the probe for AX data.")
}
log("Perform the checklist actions now. Lines print on every change. Ctrl-C to stop.")
log(String(repeating: "-", count: 72))

// ── tick ──────────────────────────────────────────────────────────────────────
var lastSig = ""
var ticks = 0
func tick() {
  ticks += 1
  guard let front = NSWorkspace.shared.frontmostApplication else {
    let sig = "nil-frontmost"
    if sig != lastSig { log("POLL frontmostApplication = nil"); lastSig = sig }
    return
  }
  let pid = front.processIdentifier
  let name = front.localizedName
  let bundle = front.bundleIdentifier
  let ax = axFocusedWindowTitle(pid: pid)
  let cg = cgFrontWindow(pid: pid)

  var browserPart = ""
  if isBrowser(name, bundle) {
    let auth = automationStatus(bundleId: bundle ?? "")
    if isFirefox(name) {
      browserPart = " | browser=Firefox(no tab scripting dictionary) automation=\(auth)"
    } else {
      let r = runOsa(tabScript(appName: name ?? "", safari: isSafari(name)))
      let url = r.out.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
      browserPart = " | tab.url=\"\(url)\" osa.code=\(r.code) (\(r.ms)ms)"
        + (r.err.isEmpty ? "" : " osa.stderr=\"\(r.err.prefix(160))\"")
        + " automation=\(auth)"
    }
  }

  let sig = "\(bundle ?? "?")|\(ax.title ?? "")|\(cg.found)|\(browserPart)"
  if sig != lastSig || ticks % 15 == 0 {
    log("POLL front=\(name ?? "?") [\(bundle ?? "?")] pid=\(pid)"
      + " | AXwin=\(ax.status):\"\(ax.title ?? "")\""
      + " | CGwin found=\(cg.found) name=\"\(cg.name ?? "")\" onscreen=\(cg.count)"
      + browserPart
      + (sig == lastSig ? "  (heartbeat)" : ""))
    lastSig = sig
  }
}

// ── run (NSApplication accessory so notifications deliver; no dock icon) ──────
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let nc = NSWorkspace.shared.notificationCenter
nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
  let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  log("EVENT didActivateApplication -> \(a?.localizedName ?? "?") [\(a?.bundleIdentifier ?? "?")]")
}
nc.addObserver(forName: NSWorkspace.didDeactivateApplicationNotification, object: nil, queue: .main) { note in
  let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  log("EVENT didDeactivateApplication <- \(a?.localizedName ?? "?")")
}
nc.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
  let f = NSWorkspace.shared.frontmostApplication
  log("EVENT activeSpaceDidChange (frontmost now: \(f?.localizedName ?? "?")) <-- FULL-SCREEN / SPACES SWITCH")
}

Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in tick() }
tick()
app.run()
