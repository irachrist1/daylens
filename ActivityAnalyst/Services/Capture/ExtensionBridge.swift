import Foundation
#if canImport(Network)
import Network
#endif

/// Bridges browser extensions to the native app via a local WebSocket server.
/// Extensions connect to ws://localhost:{port} and send tab/URL change messages.
///
/// Protocol: JSON messages with the following shape:
/// {
///   "type": "tabChanged" | "urlChanged" | "extensionInstalled",
///   "browser": "chrome" | "safari" | "arc" | ...,
///   "url": "https://...",
///   "title": "Page Title",
///   "domain": "example.com",
///   "isPrivate": false,
///   "timestamp": 1234567890.123
/// }
final class ExtensionBridge {
    var onBrowserEvent: ((ActivityEvent) -> Void)?
    var onExtensionConnected: ((String) -> Void)?

    private let port: UInt16

    #if canImport(Network)
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    #endif

    init(port: UInt16 = TrackingRules.extensionBridgePort) {
        self.port = port
    }

    func start() {
        #if canImport(Network)
        let parameters = NWParameters.tcp
        let wsOptions = NWProtocolWebSocket.Options()
        parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        do {
            listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            print("ExtensionBridge: Failed to create listener: \(error)")
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                print("ExtensionBridge: Listening on port \(self?.port ?? 0)")
            case .failed(let error):
                print("ExtensionBridge: Listener failed: \(error)")
                self?.listener?.cancel()
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleNewConnection(connection)
        }

        listener?.start(queue: .global(qos: .utility))
        #endif
    }

    func stop() {
        #if canImport(Network)
        listener?.cancel()
        listener = nil
        for connection in connections {
            connection.cancel()
        }
        connections.removeAll()
        #endif
    }

    #if canImport(Network)
    private func handleNewConnection(_ connection: NWConnection) {
        connections.append(connection)

        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                print("ExtensionBridge: Extension connected")
                self?.receiveMessages(on: connection)
            case .failed, .cancelled:
                self?.connections.removeAll { $0 === connection }
            default:
                break
            }
        }

        connection.start(queue: .global(qos: .utility))
    }

    private func receiveMessages(on connection: NWConnection) {
        connection.receiveMessage { [weak self] content, context, isComplete, error in
            guard let self = self else { return }

            if let error = error {
                print("ExtensionBridge: Receive error: \(error)")
                return
            }

            if let data = content {
                self.processMessage(data)
            }

            if error == nil {
                self.receiveMessages(on: connection)
            }
        }
    }
    #endif

    private func processMessage(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        let messageType = json["type"] as? String ?? ""
        let browser = json["browser"] as? String ?? "unknown"
        let url = json["url"] as? String
        let title = json["title"] as? String
        let domain = json["domain"] as? String
        let isPrivate = json["isPrivate"] as? Bool ?? false

        switch messageType {
        case "extensionInstalled":
            onExtensionConnected?(browser)
            return

        case "tabChanged", "urlChanged":
            let eventType: EventType = messageType == "tabChanged" ? .tabChanged : .urlChanged

            let browserBundleId = browserBundleIdentifier(for: browser)
            let appId = UUID(uuid: UUID.namespaceDNS(browserBundleId))
            let browserId = UUID(uuid: UUID.namespaceDNS("browser.\(browserBundleId)"))

            var websiteId: UUID?
            if let domain = domain {
                websiteId = UUID(uuid: UUID.namespaceDNS("website.\(domain)"))
            }

            let event = ActivityEvent(
                eventType: eventType,
                appId: appId,
                browserId: browserId,
                websiteId: websiteId,
                url: isPrivate ? nil : url,
                pageTitle: isPrivate ? nil : title,
                source: .extension,
                confidence: 1.0,
                isPrivateBrowsing: isPrivate,
                metadata: [
                    "browser": browser,
                    "domain": domain ?? "",
                    "source": "extension",
                ]
            )

            onBrowserEvent?(event)

        default:
            break
        }
    }

    private func browserBundleIdentifier(for browserName: String) -> String {
        let mapping: [String: String] = [
            "chrome": "com.google.Chrome",
            "safari": "com.apple.Safari",
            "arc": "company.thebrowser.Browser",
            "brave": "com.brave.Browser",
            "edge": "com.microsoft.edgemac",
            "firefox": "org.mozilla.firefox",
            "opera": "com.operasoftware.Opera",
            "vivaldi": "com.vivaldi.Vivaldi",
        ]
        return mapping[browserName.lowercased()] ?? "com.unknown.browser"
    }
}
