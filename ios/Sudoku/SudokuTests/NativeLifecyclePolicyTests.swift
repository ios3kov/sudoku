import Contacts
import UIKit
import XCTest
@testable import Sudoku

final class NativeLifecyclePolicyTests: XCTestCase {
    func testStartupAndPrivacyAreIndependentLifecycleStates() {
        var state = NativeLifecycleState()
        XCTAssertTrue(state.startupVisible)
        XCTAssertFalse(state.privacyVisible)

        state.apply(.willResignActive)
        XCTAssertTrue(state.startupVisible)
        XCTAssertTrue(state.privacyVisible)

        state.apply(.webLoaded)
        XCTAssertFalse(state.startupVisible)
        XCTAssertTrue(state.privacyVisible)

        state.apply(.didBecomeActive)
        XCTAssertFalse(state.startupVisible)
        XCTAssertFalse(state.privacyVisible)
    }

    func testBackgroundAlwaysRequiresPrivacyCover() {
        var state = NativeLifecycleState()
        state.apply(.webLoaded)
        state.apply(.didEnterBackground)
        XCTAssertTrue(state.privacyVisible)

        state.apply(.didBecomeActive)
        XCTAssertFalse(state.privacyVisible)
    }

    func testNativeSurfacePolicyKeepsSudokuDarkAndMessengerReadable() {
        XCTAssertEqual(NativeSurfacePolicy.statusBarStyle(for: .sudoku), .lightContent)
        XCTAssertEqual(NativeSurfacePolicy.statusBarStyle(for: .messenger), .darkContent)
        XCTAssertNotEqual(
            NativeSurfacePolicy.background(for: .sudoku),
            NativeSurfacePolicy.background(for: .messenger)
        )
        XCTAssertEqual(
            NativeSurfacePolicy.background(for: .sudoku),
            SudokuNativePalette.gameBackground
        )
    }

    func testAppSwitcherPrivacyUsesSudokuAsSafeSurface() {
        XCTAssertFalse(NativeSurfacePolicy.requiresPrivacyCover(for: .sudoku))
        XCTAssertTrue(NativeSurfacePolicy.requiresPrivacyCover(for: .messenger))
    }

    func testContactsAuthorizationMapping() {
        XCTAssertEqual(NativeContactsPolicy.name(for: .notDetermined), "not_determined")
        XCTAssertEqual(NativeContactsPolicy.name(for: .restricted), "restricted")
        XCTAssertEqual(NativeContactsPolicy.name(for: .denied), "denied")
        XCTAssertEqual(NativeContactsPolicy.name(for: .authorized), "authorized")

        if #available(iOS 18.0, *) {
            XCTAssertEqual(NativeContactsPolicy.name(for: .limited), "limited")
        }
    }
}
