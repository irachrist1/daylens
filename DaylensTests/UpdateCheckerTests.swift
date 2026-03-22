import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class UpdateCheckerTests: XCTestCase {
    func testSemanticVersionComparisonHandlesPatchUpgrade() {
        XCTAssertTrue(isNewerVersion("v1.0.6", than: "1.0.5"))
    }

    func testSemanticVersionComparisonHandlesEqualVersions() {
        XCTAssertFalse(isNewerVersion("1.0.5", than: "1.0.5"))
    }

    func testSemanticVersionComparisonHandlesMajorUpgrade() {
        XCTAssertTrue(isNewerVersion("2.0.0", than: "1.9.9"))
    }

    func testSemanticVersionComparisonHandlesOlderRemoteVersion() {
        XCTAssertFalse(isNewerVersion("1.0.4", than: "1.0.5"))
    }
}
