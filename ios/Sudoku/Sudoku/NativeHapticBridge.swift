import UIKit
import WebKit

final class NativeHapticBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "sudokuHaptics"

    func install(into controller: WKUserContentController) {
        controller.add(self, name: Self.handlerName)
    }

    func uninstall(from controller: WKUserContentController) {
        controller.removeScriptMessageHandler(forName: Self.handlerName)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName,
              message.frameInfo.isMainFrame,
              let sourceURL = message.frameInfo.request.url,
              sourceURL.scheme == "https",
              sourceURL.host == "sudoku.moscow",
              let body = message.body as? [String: Any],
              let kind = body["kind"] as? String else {
            return
        }

        switch kind {
        case "selection":
            let generator = UISelectionFeedbackGenerator()
            generator.prepare()
            generator.selectionChanged()
        case "impact":
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.prepare()
            generator.impactOccurred(intensity: 0.75)
        default:
            break
        }
    }
}
