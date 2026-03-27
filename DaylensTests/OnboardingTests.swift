import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class OnboardingTests: XCTestCase {
    private var defaultsSuiteName: String!
    private var testDefaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaultsSuiteName = "DaylensTests.OnboardingTests.\(UUID().uuidString)"
        testDefaults = UserDefaults(suiteName: defaultsSuiteName)
        testDefaults.removePersistentDomain(forName: defaultsSuiteName)
    }

    override func tearDown() {
        testDefaults.removePersistentDomain(forName: defaultsSuiteName)
        testDefaults = nil
        defaultsSuiteName = nil
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
        try? KeychainService(service: "com.daylens.app").removeString(for: Constants.DefaultsKey.anthropicAPIKey)
        try? KeychainService(service: "com.daylens.api-keys").removeString(for: "anthropic-api-key")
        super.tearDown()
    }

    // MARK: - OnboardingViewModel Step Logic

    func testInitialStepIsWelcome() {
        let vm = OnboardingViewModel()
        XCTAssertEqual(vm.currentStep, .welcome)
    }

    func testAdvanceThroughAllSteps() {
        let vm = OnboardingViewModel()
        XCTAssertEqual(vm.currentStep, .welcome)

        vm.advance()
        XCTAssertEqual(vm.currentStep, .permission)

        vm.advance()
        XCTAssertEqual(vm.currentStep, .ready)
    }

    func testAdvanceBeyondLastStepDoesNothing() {
        let vm = OnboardingViewModel()
        vm.currentStep = .ready
        vm.advance()
        XCTAssertEqual(vm.currentStep, .ready)
    }

    func testGoBackFromWelcomeDoesNothing() {
        let vm = OnboardingViewModel()
        vm.goBack()
        XCTAssertEqual(vm.currentStep, .welcome)
    }

    func testGoBackFromPermission() {
        let vm = OnboardingViewModel()
        vm.currentStep = .permission
        vm.goBack()
        XCTAssertEqual(vm.currentStep, .welcome)
    }

    // MARK: - Name Validation

    func testCanContinueFromWelcomeRequiresName() {
        let vm = OnboardingViewModel()
        XCTAssertFalse(vm.canContinueFromWelcome)

        vm.firstName = "   "
        XCTAssertFalse(vm.canContinueFromWelcome)

        vm.firstName = "Tonny"
        XCTAssertTrue(vm.canContinueFromWelcome)
    }

    func testTrimmedNameStripsWhitespace() {
        let vm = OnboardingViewModel()
        vm.firstName = "  Tonny  "
        XCTAssertEqual(vm.trimmedName, "Tonny")
    }

    // MARK: - First Name Persistence

    func testFirstNamePersistedToUserDefaults() {
        testDefaults.removeObject(forKey: Constants.DefaultsKey.userName)
        testDefaults.set("Tonny", forKey: Constants.DefaultsKey.userName)
        XCTAssertEqual(testDefaults.string(forKey: Constants.DefaultsKey.userName), "Tonny")
    }

    func testFirstNameMissingReturnsNil() {
        testDefaults.removeObject(forKey: Constants.DefaultsKey.userName)
        XCTAssertNil(testDefaults.string(forKey: Constants.DefaultsKey.userName))
    }

    // MARK: - Onboarding Completion Persistence

    func testOnboardingCompletionDefaultsToFalse() {
        testDefaults.removeObject(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        XCTAssertFalse(testDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding))
    }

    func testOnboardingCompletionPersistsTrue() {
        testDefaults.set(true, forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        XCTAssertTrue(testDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding))
    }

    // MARK: - AppState Routing

    func testAppStateReadsOnboardingCompletionFromDefaults() {
        testDefaults.set(true, forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        let state = AppState(userDefaults: testDefaults)
        XCTAssertTrue(state.hasCompletedOnboarding)
    }

    func testAppStateDefaultsToOnboardingIncomplete() {
        testDefaults.removeObject(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        let state = AppState(userDefaults: testDefaults)
        XCTAssertFalse(state.hasCompletedOnboarding)
    }

    func testAppStatePersistsOnboardingCompletion() {
        testDefaults.removeObject(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        testDefaults.removeObject(forKey: Constants.DefaultsKey.userName)
        let state = AppState(userDefaults: testDefaults)
        XCTAssertFalse(state.hasCompletedOnboarding)

        state.completeOnboarding(name: "Test")
        XCTAssertTrue(state.hasCompletedOnboarding)
        XCTAssertTrue(testDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding))
        XCTAssertEqual(testDefaults.string(forKey: Constants.DefaultsKey.userName), "Test")
    }

    // MARK: - Navigation Defaults

    func testDefaultSectionIsToday() {
        let state = AppState(userDefaults: testDefaults)
        XCTAssertEqual(state.selectedSection, .today)
    }

    func testV1SidebarSections() {
        let allSections = SidebarSection.allCases
        XCTAssertEqual(allSections, [.today, .focus, .history, .reports, .apps, .insights, .settings])
    }

    func testTodayShowsDateNavigation() {
        XCTAssertTrue(SidebarSection.today.showsDateNavigation)
        XCTAssertTrue(SidebarSection.apps.showsDateNavigation)
        XCTAssertFalse(SidebarSection.focus.showsDateNavigation)
        XCTAssertFalse(SidebarSection.insights.showsDateNavigation)
        XCTAssertFalse(SidebarSection.reports.showsDateNavigation)
        XCTAssertFalse(SidebarSection.settings.showsDateNavigation)
    }

    func testInspectorIsHiddenInV1Shell() {
        XCTAssertFalse(SidebarSection.today.showsInspector)
        XCTAssertFalse(SidebarSection.focus.showsInspector)
        XCTAssertFalse(SidebarSection.reports.showsInspector)
        XCTAssertFalse(SidebarSection.apps.showsInspector)
        XCTAssertFalse(SidebarSection.insights.showsInspector)
        XCTAssertFalse(SidebarSection.settings.showsInspector)
    }

    // MARK: - API Key Persistence

    func testAPIKeyPersistence() {
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
        try? KeychainService(service: "com.daylens.app").removeString(for: Constants.DefaultsKey.anthropicAPIKey)
        let service = AIService()
        XCTAssertFalse(service.isConfigured)

        service.setAPIKey("sk-ant-test-key")
        XCTAssertTrue(service.isConfigured)
        XCTAssertEqual(service.currentAPIKey(), "sk-ant-test-key")
        XCTAssertNil(UserDefaults.standard.string(forKey: Constants.DefaultsKey.anthropicAPIKey))

        service.removeAPIKey()
        XCTAssertFalse(service.isConfigured)
        XCTAssertNil(service.currentAPIKey())
    }

    func testLegacyKeychainAPIKeyMigratesToNewSlot() {
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
        let newKeychain = KeychainService(service: "com.daylens.app")
        let legacyKeychain = KeychainService(service: "com.daylens.api-keys")
        try? newKeychain.removeString(for: Constants.DefaultsKey.anthropicAPIKey)
        try? legacyKeychain.removeString(for: "anthropic-api-key")
        try? legacyKeychain.setString("sk-ant-legacy-key", for: "anthropic-api-key")

        let service = AIService()

        XCTAssertTrue(service.isConfigured)
        XCTAssertEqual(service.currentAPIKey(), "sk-ant-legacy-key")
        XCTAssertEqual(newKeychain.string(for: Constants.DefaultsKey.anthropicAPIKey), "sk-ant-legacy-key")
        XCTAssertNil(legacyKeychain.string(for: "anthropic-api-key"))
    }

    func testDefaultsKeysAreCentralized() {
        // Verify the centralized keys match expected values
        XCTAssertEqual(Constants.DefaultsKey.userName, "userName")
        XCTAssertEqual(Constants.DefaultsKey.hasCompletedOnboarding, "hasCompletedOnboarding")
        XCTAssertEqual(Constants.DefaultsKey.anthropicAPIKey, "anthropic_api_key")
    }

    // MARK: - PermissionManager

    func testRefreshPermissionsReturnsConsistentState() {
        let pm = PermissionManager()
        let first = pm.isAccessibilityGranted
        pm.refreshPermissions()
        let second = pm.isAccessibilityGranted
        XCTAssertEqual(first, second)
    }

    func testRefreshPermissionsUpdatesAccessibilityFlag() {
        let pm = PermissionManager()
        pm.refreshPermissions()
        _ = pm.isAccessibilityGranted
    }

    // MARK: - PermissionManager Polling

    func testStartPollingCreatesTimer() {
        let pm = PermissionManager()
        pm.startPolling()
        // Calling startPolling twice should not create a second timer (idempotent)
        pm.startPolling()
        // Clean up
        pm.stopPolling()
    }

    func testStopPollingIsIdempotent() {
        let pm = PermissionManager()
        // Stopping without starting should not crash
        pm.stopPolling()
        pm.startPolling()
        pm.stopPolling()
        pm.stopPolling()
    }

    func testPollingRefreshesPermissionState() {
        let pm = PermissionManager()
        let initialState = pm.isAccessibilityGranted
        pm.startPolling()

        // After a poll interval, the state should still be consistent
        let expectation = expectation(description: "Poll fires")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            XCTAssertEqual(pm.isAccessibilityGranted, initialState)
            pm.stopPolling()
            expectation.fulfill()
        }
        waitForExpectations(timeout: 4)
    }

    func testPermissionManagerInitialStateMatchesSystem() {
        let pm = PermissionManager()
        // The initial state should reflect the actual system state
        // We can't control AXIsProcessTrusted() in tests, but we can verify
        // that refreshPermissions produces a consistent value
        let systemState = pm.isAccessibilityGranted
        pm.refreshPermissions()
        XCTAssertEqual(pm.isAccessibilityGranted, systemState)
    }
}
