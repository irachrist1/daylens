import Foundation
import Network

/// Runs a local HTTP server on 127.0.0.1:27182 that browser extensions POST
/// tab-change events to. This is the high-confidence path for website attribution.
///
/// Security: bound to loopback only; no authentication needed for localhost IPC.
final class BrowserExtensionReceiver {
    static let port: UInt16 = 27182

    private var listener: NWListener?
    private let normalizer: SessionNormalizer
    private let queue = DispatchQueue(label: "com.daylens.extension-receiver", qos: .utility)

    private(set) var isRunning = false
    var onExtensionConnected: ((String) -> Void)?  // browserName

    init(normalizer: SessionNormalizer) {
        self.normalizer = normalizer
    }

    // MARK: - Lifecycle

    func start() throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: .ipv4(.loopback),
            port: NWEndpoint.Port(rawValue: Self.port)!
        )

        let listener = try NWListener(using: params)
        self.listener = listener
        isRunning = true

        listener.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed(let error):
                print("[BrowserExtensionReceiver] Listener failed: \(error)")
                self?.isRunning = false
            case .cancelled:
                self?.isRunning = false
            default:
                break
            }
        }

        listener.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        listener = nil
        isRunning = false
    }

    // MARK: - Connection handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)

        // Read the entire HTTP request
        receiveHTTPRequest(from: connection) { [weak self] data in
            guard let self, let data else {
                connection.cancel()
                return
            }

            self.processRequest(data: data, connection: connection)
        }
    }

    private func receiveHTTPRequest(from connection: NWConnection, completion: @escaping (Data?) -> Void) {
        // Read up to 8KB — more than enough for a tab event
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, isComplete, error in
            if let error {
                print("[BrowserExtensionReceiver] Receive error: \(error)")
                completion(nil)
                return
            }
            completion(data)
        }
    }

    private func processRequest(data: Data, connection: NWConnection) {
        // Parse HTTP: find the body after \r\n\r\n
        guard let requestString = String(data: data, encoding: .utf8) else {
            sendResponse(to: connection, status: 400, body: "Bad request")
            return
        }

        guard let bodyStart = requestString.range(of: "\r\n\r\n") else {
            sendResponse(to: connection, status: 400, body: "No body")
            return
        }

        let bodyString = String(requestString[bodyStart.upperBound...])
        guard let bodyData = bodyString.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        else {
            sendResponse(to: connection, status: 400, body: "Invalid JSON")
            return
        }

        // Dispatch to normalizer on main queue
        DispatchQueue.main.async { [weak self] in
            self?.handlePayload(payload)
        }

        sendResponse(to: connection, status: 200, body: "OK")
    }

    // MARK: - Payload handling

    private func handlePayload(_ payload: [String: Any]) {
        guard let domain = payload["domain"] as? String,
              let browser = payload["browser"] as? String
        else { return }

        let title = payload["title"] as? String
        let url = payload["url"] as? String
        let isPrivate = payload["is_private"] as? Bool ?? false
        let timestamp = payload["timestamp"] as? Double ?? Date().timeIntervalSince1970

        // Notify about extension being active
        onExtensionConnected?(browser)

        // Extract a clean URL slug (path without query)
        let urlSlug: String? = url.flatMap { rawURL in
            guard let u = URL(string: rawURL) else { return nil }
            return u.path.isEmpty ? nil : u.path
        }

        let event = ActivityEvent(
            timestamp: timestamp,
            eventType: .websiteVisit,
            browserName: browser,
            domain: domain,
            pageTitle: isPrivate ? nil : title,
            urlSlug: isPrivate ? nil : urlSlug,
            isPrivate: isPrivate,
            source: browser.lowercased().contains("safari") ? .extensionSafari : .extensionChromium,
            confidence: 1.0
        )
        normalizer.process(event)
    }

    // MARK: - HTTP response

    private func sendResponse(to connection: NWConnection, status: Int, body: String) {
        let response = """
        HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\n\
        Content-Type: text/plain\r\n\
        Content-Length: \(body.utf8.count)\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Connection: close\r\n\
        \r\n\
        \(body)
        """
        let data = response.data(using: .utf8)!
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
