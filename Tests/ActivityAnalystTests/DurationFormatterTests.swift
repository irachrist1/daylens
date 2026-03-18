import XCTest
@testable import ActivityAnalystCore

final class DurationFormatterTests: XCTestCase {

    func testSecondsFormat() {
        XCTAssertEqual(DurationFormatter.format(30), "30s")
        XCTAssertEqual(DurationFormatter.format(0), "0s")
        XCTAssertEqual(DurationFormatter.format(59), "59s")
    }

    func testMinutesFormat() {
        XCTAssertEqual(DurationFormatter.format(60), "1m")
        XCTAssertEqual(DurationFormatter.format(300), "5m")
        XCTAssertEqual(DurationFormatter.format(3540), "59m")
    }

    func testHoursFormat() {
        XCTAssertEqual(DurationFormatter.format(3600), "1h")
        XCTAssertEqual(DurationFormatter.format(7200), "2h")
        XCTAssertEqual(DurationFormatter.format(8100), "2h 15m")
    }

    func testLongFormat() {
        XCTAssertEqual(DurationFormatter.formatLong(30), "30 seconds")
        XCTAssertEqual(DurationFormatter.formatLong(60), "1 minute")
        XCTAssertEqual(DurationFormatter.formatLong(3660), "1 hour, 1 minute")
        XCTAssertEqual(DurationFormatter.formatLong(7200), "2 hours")
    }

    func testDecimalFormat() {
        XCTAssertEqual(DurationFormatter.formatDecimal(300), "5m")
        XCTAssertEqual(DurationFormatter.formatDecimal(3600), "1.0h")
        XCTAssertEqual(DurationFormatter.formatDecimal(5400), "1.5h")
    }

    func testPercentageFormat() {
        XCTAssertEqual(DurationFormatter.formatPercentage(0.45), "45%")
        XCTAssertEqual(DurationFormatter.formatPercentage(1.0), "100%")
        XCTAssertEqual(DurationFormatter.formatPercentage(0.0), "0%")
    }
}
