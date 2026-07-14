import AppKit
import CoreGraphics
import Foundation

final class SmokeWindowDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let title: String
    private let mode: String
    private let duration: TimeInterval
    private let statePath: String
    private var window: NSWindow?
    private var activationTimer: Timer?

    init(title: String, mode: String, duration: TimeInterval, statePath: String) {
        self.title = title
        self.mode = mode
        self.duration = duration
        self.statePath = statePath
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1280, height: 720)
        let frame = NSRect(x: screenFrame.midX - 400, y: screenFrame.midY - 250, width: 800, height: 500)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.delegate = self
        window.contentView = NSView(frame: frame)
        self.window = window

        NSApp.setActivationPolicy(.regular)
        CGWarpMouseCursorPosition(CGPoint(x: screenFrame.midX, y: screenFrame.midY))
        activateProbe(attempt: 0)

        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
            NSApp.terminate(nil)
        }
    }

    private func activateProbe(attempt: Int) {
        activateWindow()
        guard let window else { return }
        if !NSApp.isActive || !window.isKeyWindow {
            if attempt >= 16 {
                fputs("Probe window did not become the active macOS window.\n", stderr)
                exit(1)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.activateProbe(attempt: attempt + 1)
            }
            return
        }

        activationTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.activateWindow()
        }
        if mode == "fullscreen" {
            window.toggleFullScreen(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                self?.recordState()
            }
        } else {
            recordState()
        }
    }

    private func activateWindow() {
        NSRunningApplication.current.activate(options: [.activateAllWindows])
        NSApp.activate(ignoringOtherApps: true)
        window?.orderFrontRegardless()
        window?.makeKeyAndOrderFront(nil)
    }

    private func recordState() {
        guard let window else { return }
        let activated = NSApp.isActive && window.isKeyWindow
        let fullscreen = window.styleMask.contains(.fullScreen)
        if !activated {
            activateWindow()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.recordState()
            }
            return
        }
        if mode == "fullscreen" && !fullscreen {
            fputs("Probe window did not enter macOS fullscreen.\n", stderr)
            NSApp.terminate(nil)
            return
        }

        var state = (try? Data(contentsOf: URL(fileURLWithPath: statePath)))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            ?? [:]
        state[mode == "fullscreen" ? "fullscreen" : "foreground"] = [
            "title": title,
            "activated": activated,
            "fullscreen": fullscreen,
        ]
        let data = try! JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        try! data.write(to: URL(fileURLWithPath: statePath), options: .atomic)
    }
}

guard CommandLine.arguments.count == 5 else {
    fputs("Usage: RuntimeCaptureProbe <title> <foreground|fullscreen> <duration-seconds> <state-path>\n", stderr)
    exit(2)
}

let app = NSApplication.shared
let delegate = SmokeWindowDelegate(
    title: CommandLine.arguments[1],
    mode: CommandLine.arguments[2],
    duration: TimeInterval(CommandLine.arguments[3]) ?? 18,
    statePath: CommandLine.arguments[4]
)
app.delegate = delegate
app.run()
