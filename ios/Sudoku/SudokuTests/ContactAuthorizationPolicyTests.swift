import Contacts
import XCTest
@testable import Sudoku

final class ContactAuthorizationPolicyTests: XCTestCase {
    func testKnownAuthorizationStates() {
        XCTAssertEqual(ContactAuthorizationPolicy.state(for: .notDetermined), .notDetermined)
        XCTAssertEqual(ContactAuthorizationPolicy.state(for: .restricted), .restricted)
        XCTAssertEqual(ContactAuthorizationPolicy.state(for: .denied), .denied)
        XCTAssertEqual(ContactAuthorizationPolicy.state(for: .authorized), .granted)
    }

    func testLimitedAuthorizationOnIOS18() {
        if #available(iOS 18.0, *) {
            XCTAssertEqual(ContactAuthorizationPolicy.state(for: .limited), .limited)
        }
    }
}
