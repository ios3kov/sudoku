import XCTest
@testable import Sudoku

final class NavigationPolicyTests: XCTestCase {
    func testExternalNavigationAllowsOnlyReviewedSchemes() throws {
        XCTAssertTrue(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "https://example.org/path"))))
        XCTAssertTrue(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "mailto:test@example.org"))))
        XCTAssertTrue(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "tel:+123456789"))))

        XCTAssertFalse(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "http://example.org"))))
        XCTAssertFalse(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "javascript:alert(1)"))))
        XCTAssertFalse(SudokuViewController.isAllowedExternalURL(try XCTUnwrap(URL(string: "custom-scheme://payload"))))
    }
}
