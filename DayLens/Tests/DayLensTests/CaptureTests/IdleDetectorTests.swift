import XCTest
@testable import DayLens

final class IdleDetectorTests: XCTestCase {

    private var settings: UserSettings!
    private var idleCallCount: Int!
    private var resumeCallCount: Int!
    private var detector: IdleDetector!

    override func setUp() {
        settings = UserSettings()
        settings.idleGraceSeconds = 120
        settings.isTrackingPaused = false
        idleCallCount = 0
        resumeCallCount = 0
        detector = IdleDetector(
            settings: settings,
            onIdle: { [weak self] in self?.idleCallCount += 1 },
            onResume: { [weak self] in self?.resumeCallCount += 1 }
        )
    }

    override func tearDown() {
        detector.stop()
    }

    // MARK: - Lifecycle

    func testStartSetsIsRunning() {
        XCTAssertFalse(detector.isRunning)
        detector.start()
        XCTAssertTrue(detector.isRunning)
    }

    func testStopClearsIsRunning() {
        detector.start()
        detector.stop()
        XCTAssertFalse(detector.isRunning)
    }

    func testDoubleStartIsGuarded() {
        detector.start()
        detector.start() // second call should be a no-op
        XCTAssertTrue(detector.isRunning)
        // No crash, still running
    }

    // MARK: - State machine transitions

    func testIdleCallbackFiredWhenThresholdExceeded() {
        detector.start()
        detector.simulateCheck(idleSeconds: 121)
        XCTAssertEqual(idleCallCount, 1)
        XCTAssertEqual(resumeCallCount, 0)
    }

    func testResumeCallbackFiredAfterIdle() {
        detector.start()
        detector.simulateCheck(idleSeconds: 121)
        detector.simulateCheck(idleSeconds: 5)
        XCTAssertEqual(idleCallCount, 1)
        XCTAssertEqual(resumeCallCount, 1)
    }

    func testNoCallbackBelowThreshold() {
        detector.start()
        detector.simulateCheck(idleSeconds: 50)
        XCTAssertEqual(idleCallCount, 0)
        XCTAssertEqual(resumeCallCount, 0)
    }

    func testNoDuplicateIdleCallbacks() {
        detector.start()
        detector.simulateCheck(idleSeconds: 121)
        detector.simulateCheck(idleSeconds: 200) // still idle — should not fire again
        XCTAssertEqual(idleCallCount, 1)
    }

    func testNoDuplicateResumeCallbacks() {
        detector.start()
        detector.simulateCheck(idleSeconds: 121)
        detector.simulateCheck(idleSeconds: 5)
        detector.simulateCheck(idleSeconds: 10) // still active — should not fire again
        XCTAssertEqual(resumeCallCount, 1)
    }

    // MARK: - Tracking paused

    func testTrackingPausedSuppressesIdleCallback() {
        settings.isTrackingPaused = true
        detector.start()
        detector.simulateCheck(idleSeconds: 200)
        XCTAssertEqual(idleCallCount, 0)
    }

    func testTrackingPausedSuppressesResumeCallback() {
        // Get into idle state while tracking is active, then pause
        detector.start()
        detector.simulateCheck(idleSeconds: 121)
        settings.isTrackingPaused = true
        detector.simulateCheck(idleSeconds: 5) // would normally fire onResume
        XCTAssertEqual(resumeCallCount, 0)
    }

    // MARK: - Stop resets state

    func testStopResetsIdleState() {
        detector.start()
        detector.simulateCheck(idleSeconds: 121) // go idle
        XCTAssertEqual(idleCallCount, 1)

        detector.stop()
        detector.start()

        // After restart, below-threshold check should not fire resume (not idle anymore)
        detector.simulateCheck(idleSeconds: 5)
        XCTAssertEqual(resumeCallCount, 0)

        // Above-threshold should fire idle again (fresh start)
        detector.simulateCheck(idleSeconds: 121)
        XCTAssertEqual(idleCallCount, 2)
    }

    // MARK: - simulateCheck no-ops when stopped

    func testSimulateCheckNoOpsWhenNotRunning() {
        // detector is not started
        detector.simulateCheck(idleSeconds: 200)
        XCTAssertEqual(idleCallCount, 0)
    }
}
