import XCTest
@testable import Daylens

final class BrowserHistoryReaderTests: XCTestCase {

    func testDomainExtraction() {
        let testCases: [(url: String, expected: String?)] = [
            ("https://www.youtube.com/watch?v=abc", "youtube.com"),
            ("https://github.com/user/repo", "github.com"),
            ("https://docs.google.com/spreadsheets/d/123", "docs.google.com"),
            ("https://www.reddit.com/r/swift", "reddit.com"),
            ("chrome://settings", nil),
            ("about:blank", nil),
            ("file:///Users/test/file.html", nil),
            ("https://example.com", "example.com"),
        ]

        for testCase in testCases {
            let domain = extractDomain(from: testCase.url)
            XCTAssertEqual(domain, testCase.expected, "Failed for URL: \(testCase.url)")
        }
    }

    func testChromiumEpochConversion() {
        // Chrome epoch: microseconds since Jan 1, 1601
        let chromiumEpochOffset: Int64 = 11_644_473_600_000_000
        let knownUnixTimestamp: Int64 = 1_700_000_000 // Nov 2023 roughly

        let chromiumTime = knownUnixTimestamp * 1_000_000 + chromiumEpochOffset
        let convertedUnix = (chromiumTime - chromiumEpochOffset) / 1_000_000

        XCTAssertEqual(convertedUnix, knownUnixTimestamp)
    }

    func testKnownBrowserBundleIDs() {
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("com.google.Chrome"))
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("com.apple.Safari"))
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("company.thebrowser.Browser"))
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("com.apple.dt.Xcode"))
    }

    // MARK: - Helpers

    private func extractDomain(from urlString: String) -> String? {
        guard let url = URL(string: urlString),
              let host = url.host else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
