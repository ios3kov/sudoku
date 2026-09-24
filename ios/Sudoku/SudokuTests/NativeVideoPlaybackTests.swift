import XCTest
import UIKit
@testable import Sudoku

final class NativeVideoPlaybackTests: XCTestCase {
    func testAcceptsBoundedSupportedPayloadAndRejectsInvalidData() throws {
        let (data, ext) = try NativeVideoPlayback.decode(["mimeType": "video/mp4", "base64": "AQID"])
        XCTAssertEqual(data, Data([1, 2, 3]))
        XCTAssertEqual(ext, "mp4")
        XCTAssertThrowsError(try NativeVideoPlayback.decode(["mimeType": "text/html", "base64": "AQID"]))
        XCTAssertThrowsError(try NativeVideoPlayback.decode(["mimeType": "video/mp4", "base64": ""]))
        XCTAssertThrowsError(try NativeVideoPlayback.decode(["mimeType": "video/mp4", "base64": "not base64!"]))
        XCTAssertThrowsError(try NativeVideoPlayback.decode(["url": "https://example.org/private.mp4"]))
    }

    func testRejectsOversizedPayloadBeforePlayback() {
        let encoded = String(repeating: "A", count: ((NativeVideoPlayback.maxBytes + 2) / 3) * 4 + 4)
        XCTAssertThrowsError(try NativeVideoPlayback.decode(["mimeType": "video/mp4", "base64": encoded]))
    }

    func testUsesDisplayedOrientationIncludingCameraTransform() {
        let size = CGSize(width: 1920, height: 1080)
        XCTAssertTrue(NativeVideoPlayback.isLandscape(size, transform: .identity))
        XCTAssertFalse(NativeVideoPlayback.isLandscape(size, transform: CGAffineTransform(rotationAngle: .pi / 2)))
        XCTAssertFalse(NativeVideoPlayback.isLandscape(CGSize(width: 720, height: 720), transform: .identity))
    }

    @MainActor func testOnlyLandscapeVideoControllerAllowsRotation() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("test.mp4")
        let portrait = NativeVideoPlayerController(url: url, landscape: false)
        let landscape = NativeVideoPlayerController(url: url, landscape: true)
        XCTAssertEqual(portrait.supportedInterfaceOrientations, .portrait)
        XCTAssertEqual(landscape.supportedInterfaceOrientations, .allButUpsideDown)
        XCTAssertEqual(AppDelegate().application(UIApplication.shared, supportedInterfaceOrientationsFor: nil), .portrait)
        portrait.stop(); landscape.stop()
    }
}
