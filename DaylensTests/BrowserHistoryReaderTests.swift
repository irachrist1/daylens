import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

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

    func testChromiumVisitEstimationUsesNavigationGapForegroundCapAndFallback() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let visits = [
            ChromiumHistoryVisit(
                visitID: 1,
                url: "https://www.youtube.com/watch?v=abc",
                title: "Video",
                visitTime: start,
                visitTimeMicros: 0,
                recordedDuration: 0
            ),
            ChromiumHistoryVisit(
                visitID: 2,
                url: "https://github.com/openai/gpt-5",
                title: "Repo",
                visitTime: start.addingTimeInterval(600),
                visitTimeMicros: 1,
                recordedDuration: 12
            ),
            ChromiumHistoryVisit(
                visitID: 3,
                url: "https://chatgpt.com",
                title: "ChatGPT",
                visitTime: start.addingTimeInterval(1_800),
                visitTimeMicros: 2,
                recordedDuration: 0
            ),
        ]
        let foregrounds = [
            BrowserForegroundInterval(start: start, end: start.addingTimeInterval(300)),
            BrowserForegroundInterval(start: start.addingTimeInterval(600), end: start.addingTimeInterval(900)),
            BrowserForegroundInterval(start: start.addingTimeInterval(1_800), end: start.addingTimeInterval(1_900)),
        ]

        let estimated = BrowserHistoryReader.estimateChromiumVisits(visits, foregroundIntervals: foregrounds)

        XCTAssertEqual(estimated.count, 3)
        XCTAssertEqual(estimated[0].visitDuration, 300, accuracy: 0.001)
        XCTAssertEqual(estimated[1].visitDuration, 12, accuracy: 0.001)
        XCTAssertEqual(estimated[2].visitDuration, Constants.minimumWebsiteVisitDuration, accuracy: 0.001)
    }

    // MARK: - Browser Registry & Classification

    func testPrimaryBrowserBundleIDs() {
        // Primary browsers
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("com.google.Chrome"))
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("com.apple.Safari"))
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("company.thebrowser.Browser")) // Arc
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("app.zen-browser.zen"))
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("ai.perplexity.comet"))

        // Hybrid apps are NOT in knownBrowserBundleIDs (primary set)
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("company.thebrowser.dia"))
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("com.openai.atlas"))

        // Non-browser apps
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("com.apple.dt.Xcode"))
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("com.blackboxai.desktopapp"))
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("ai.perplexity.mac"))
    }

    func testBrowserCapableBundleIDsIncludesHybrids() {
        // Primary browsers are browser-capable
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("com.google.Chrome"))
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("com.apple.Safari"))
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("company.thebrowser.Browser"))

        // Hybrid apps are browser-capable
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("company.thebrowser.dia"))
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("com.openai.atlas"))

        // Excluded apps are NOT browser-capable
        XCTAssertFalse(Constants.browserCapableBundleIDs.contains("com.blackboxai.desktopapp"))
        XCTAssertFalse(Constants.browserCapableBundleIDs.contains("ai.perplexity.mac"))
        XCTAssertFalse(Constants.browserCapableBundleIDs.contains("com.anthropic.claudefordesktop"))
    }

    func testBrowserDefinitionsComplete() {
        // Every definition must have a non-empty bundle ID and display name
        for def in BrowserDefinition.all {
            XCTAssertFalse(def.bundleID.isEmpty, "Empty bundle ID in BrowserDefinition")
            XCTAssertFalse(def.displayName.isEmpty, "Empty display name for \(def.bundleID)")
            XCTAssertFalse(def.historyRelativePath.isEmpty, "Empty history path for \(def.bundleID)")
        }
    }

    func testBrowserNamesMatchDefinitions() {
        // Constants.browserNames should have an entry for every browser-capable app
        for bundleID in Constants.browserCapableBundleIDs {
            XCTAssertNotNil(Constants.browserNames[bundleID], "Missing browser name for \(bundleID)")
        }
    }

    func testZenIsFirefoxBased() {
        let zenDef = BrowserDefinition.all.first { $0.bundleID == "app.zen-browser.zen" }
        XCTAssertNotNil(zenDef)
        XCTAssertEqual(zenDef?.engine, .firefox)
        XCTAssertFalse(zenDef?.supportsAppleScript ?? true)
    }

    func testCometIsChromiumBased() {
        let cometDef = BrowserDefinition.all.first { $0.bundleID == "ai.perplexity.comet" }
        XCTAssertNotNil(cometDef)
        XCTAssertEqual(cometDef?.engine, .chromium)
        XCTAssertTrue(cometDef?.supportsAppleScript ?? false)
    }

    // MARK: - Classification Discipline

    func testDiaIsHybridAIPrimaryBrowserCapable() {
        // Primary category is AI Tools
        let classification = AppCategory.classify(bundleID: "company.thebrowser.dia", appName: "Dia")
        XCTAssertEqual(classification.category, .aiTools, "Dia primary category should be AI Tools")
        XCTAssertEqual(classification.confidence, .high)

        // NOT a primary browser
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("company.thebrowser.dia"))

        // IS browser-capable (history will be read)
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("company.thebrowser.dia"))

        // Definition confirms hybrid role
        let def = BrowserDefinition.allHybrid.first { $0.bundleID == "company.thebrowser.dia" }
        XCTAssertNotNil(def)
        XCTAssertEqual(def?.role, .hybrid)
        XCTAssertEqual(def?.engine, .chromium)
        XCTAssertTrue(def?.supportsAppleScript ?? false)
        XCTAssertEqual(def?.primaryCategory, .aiTools)
    }

    func testAtlasIsHybridAIPrimaryBrowserCapable() {
        // Primary category is AI Tools
        let classification = AppCategory.classify(bundleID: "com.openai.atlas", appName: "ChatGPT Atlas")
        XCTAssertEqual(classification.category, .aiTools, "Atlas primary category should be AI Tools")
        XCTAssertEqual(classification.confidence, .high)

        // NOT a primary browser
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("com.openai.atlas"))

        // IS browser-capable (history will be read)
        XCTAssertTrue(Constants.browserCapableBundleIDs.contains("com.openai.atlas"))

        // Definition confirms hybrid role
        let def = BrowserDefinition.allHybrid.first { $0.bundleID == "com.openai.atlas" }
        XCTAssertNotNil(def)
        XCTAssertEqual(def?.role, .hybrid)
        XCTAssertEqual(def?.engine, .chromium)
        XCTAssertFalse(def?.supportsAppleScript ?? true, "Atlas has no sdef — no AppleScript")
        XCTAssertEqual(def?.primaryCategory, .aiTools)
    }

    func testBLACKBOXAIClassifiedAsAI() {
        let classification = AppCategory.classify(bundleID: "com.blackboxai.desktopapp", appName: "BLACKBOXAI")
        XCTAssertEqual(classification.category, .aiTools)
    }

    func testPerplexityDesktopIsAINotBrowser() {
        let classification = AppCategory.classify(bundleID: "ai.perplexity.mac", appName: "Perplexity")
        XCTAssertEqual(classification.category, .aiTools)
        XCTAssertFalse(Constants.knownBrowserBundleIDs.contains("ai.perplexity.mac"))
    }

    func testCometIsBrowser() {
        let classification = AppCategory.classify(bundleID: "ai.perplexity.comet", appName: "Comet")
        XCTAssertEqual(classification.category, .browsing)
        XCTAssertTrue(Constants.knownBrowserBundleIDs.contains("ai.perplexity.comet"))
    }

    func testProductivityOfficeAppsUseExactBundleRules() {
        XCTAssertEqual(AppCategory.classify(bundleID: "com.microsoft.excel", appName: "Excel").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.microsoft.word", appName: "Word").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.microsoft.powerpoint", appName: "PowerPoint").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.apple.iWork.Numbers", appName: "Numbers").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.apple.iWork.Pages", appName: "Pages").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.apple.iWork.Keynote", appName: "Keynote").category, .productivity)
        XCTAssertEqual(AppCategory.classify(bundleID: "com.notion.id", appName: "Notion").category, .productivity)
    }

    func testZenIsBrowser() {
        let classification = AppCategory.classify(bundleID: "app.zen-browser.zen", appName: "Zen")
        XCTAssertEqual(classification.category, .browsing)
    }

    func testExcludedBundleIDsNotBrowserCapable() {
        for excludedID in BrowserRegistry.excludedBundleIDs {
            XCTAssertFalse(
                Constants.knownBrowserBundleIDs.contains(excludedID),
                "\(excludedID) is excluded but appears in knownBrowserBundleIDs"
            )
            XCTAssertFalse(
                Constants.browserCapableBundleIDs.contains(excludedID),
                "\(excludedID) is excluded but appears in browserCapableBundleIDs"
            )
        }
    }

    func testHybridAppsNotInPrimaryBrowserList() {
        for def in BrowserDefinition.allHybrid {
            XCTAssertFalse(
                Constants.knownBrowserBundleIDs.contains(def.bundleID),
                "Hybrid app \(def.displayName) should not be in primary browser list"
            )
            XCTAssertTrue(
                Constants.browserCapableBundleIDs.contains(def.bundleID),
                "Hybrid app \(def.displayName) should be browser-capable"
            )
        }
    }

    func testPrimaryBrowsersHaveBrowsingCategory() {
        for def in BrowserDefinition.allPrimary {
            XCTAssertEqual(def.role, .primary)
            XCTAssertEqual(def.primaryCategory, .browsing,
                "Primary browser \(def.displayName) should have .browsing as primaryCategory")
        }
    }

    func testHybridAppsHaveNonBrowsingPrimaryCategory() {
        for def in BrowserDefinition.allHybrid {
            XCTAssertEqual(def.role, .hybrid)
            XCTAssertNotEqual(def.primaryCategory, .browsing,
                "Hybrid app \(def.displayName) should NOT have .browsing as primaryCategory")
        }
    }

    // MARK: - Domain Intelligence

    func testDomainClassificationExactMatch() {
        let github = DomainIntelligence.classify(domain: "github.com")
        XCTAssertEqual(github.siteGroup, "GitHub")
        XCTAssertEqual(github.category, .development)
        XCTAssertEqual(github.confidence, .high)
    }

    func testDomainClassificationSubdomain() {
        let ghPages = DomainIntelligence.classify(domain: "user.github.io")
        XCTAssertEqual(ghPages.siteGroup, "GitHub Pages")

        let docsGoogle = DomainIntelligence.classify(domain: "docs.google.com")
        XCTAssertEqual(docsGoogle.siteGroup, "Google Docs")
        XCTAssertEqual(docsGoogle.category, .writing)
    }

    func testDomainClassificationAISites() {
        let claude = DomainIntelligence.classify(domain: "claude.ai")
        XCTAssertEqual(claude.category, .aiTools)

        let chatgpt = DomainIntelligence.classify(domain: "chatgpt.com")
        XCTAssertEqual(chatgpt.category, .aiTools)
    }

    func testDomainClassificationUnknown() {
        let unknown = DomainIntelligence.classify(domain: "totally-random-site.xyz")
        XCTAssertNil(unknown.siteGroup)
        XCTAssertEqual(unknown.category, .uncategorized)
        XCTAssertEqual(unknown.confidence, .low)
    }

    func testDomainGrouping() {
        let summaries = [
            WebsiteUsageSummary(domain: "github.com", totalDuration: 600, visitCount: 5, topPageTitle: "Repo", confidence: .high, browserName: "Chrome"),
            WebsiteUsageSummary(domain: "gist.github.com", totalDuration: 120, visitCount: 2, topPageTitle: "Gist", confidence: .high, browserName: "Chrome"),
            WebsiteUsageSummary(domain: "youtube.com", totalDuration: 300, visitCount: 3, topPageTitle: "Video", confidence: .high, browserName: "Arc"),
        ]

        let grouped = DomainIntelligence.groupedSummaries(from: summaries)

        // github.com and gist.github.com should merge under "GitHub"
        let githubGroup = grouped.first { $0.siteGroup == "GitHub" }
        XCTAssertNotNil(githubGroup)
        XCTAssertEqual(githubGroup?.totalDuration, 720) // 600 + 120
        XCTAssertEqual(githubGroup?.domainCount, 2)

        let youtubeGroup = grouped.first { $0.siteGroup == "YouTube" }
        XCTAssertNotNil(youtubeGroup)
        XCTAssertEqual(youtubeGroup?.totalDuration, 300)
    }

    // MARK: - Helpers

    private func extractDomain(from urlString: String) -> String? {
        BrowserHistoryReader.normalizedDomain(from: urlString)
    }
}
