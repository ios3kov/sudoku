import Foundation
import UIKit
import WebKit

final class NativeMediaBridge: NSObject {
    static let handlerName = "sudokuMedia"
    static let readyEvent = "sudoku:native-media-ready"

    weak var webView: WKWebView?
    weak var presenter: UIViewController?

    private let picker = NativeMediaPicker()

    func install(into controller: WKUserContentController) {
        controller.add(self, name: Self.handlerName)
        controller.addUserScript(
            WKUserScript(
                source: Self.bridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
    }

    func uninstall(from controller: WKUserContentController) {
        controller.removeScriptMessageHandler(forName: Self.handlerName)
    }

    private func resolve(requestID: String, file: NativePickedFile) {
        guard let webView else { return }
        let payload: [String: Any] = [
            "name": file.name,
            "mimeType": file.mimeType,
            "size": file.data.count,
            "base64": file.data.base64EncodedString(),
        ]
        DispatchQueue.main.async {
            webView.callAsyncJavaScript(
                "window.__sudokuNativeMediaResolve(id, value);",
                arguments: [
                    "id": requestID,
                    "value": payload,
                ],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }

    private func reject(
        requestID: String,
        name: String,
        message: String
    ) {
        guard let webView else { return }
        DispatchQueue.main.async {
            webView.callAsyncJavaScript(
                "window.__sudokuNativeMediaReject(id, name, message);",
                arguments: [
                    "id": requestID,
                    "name": name,
                    "message": message,
                ],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }

    private static let bridgeScript = #"""
    (() => {
      if (location.protocol !== "https:" || location.hostname !== "sudoku.moscow") return;

      const pending = new Map();
      let sequence = 0;

      window.SudokuNativeMedia = {
        pickAttachment() {
          return new Promise((resolve, reject) => {
            const id = String(++sequence);
            pending.set(id, { resolve, reject });
            window.webkit.messageHandlers.sudokuMedia.postMessage({ id });
          });
        }
      };

      window.__sudokuNativeMediaResolve = (id, value) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.resolve(value);
      };

      window.__sudokuNativeMediaReject = (id, name, message) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new DOMException(
          message || "Native attachment picker failed",
          name || "OperationError"
        ));
      };

      window.dispatchEvent(new Event("sudoku:native-media-ready"));
    })();
    """#
}

extension NativeMediaBridge: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName else { return }
        guard message.frameInfo.isMainFrame else { return }
        guard let sourceURL = message.frameInfo.request.url,
              sourceURL.scheme == "https",
              sourceURL.host == "sudoku.moscow" else {
            return
        }
        guard let body = message.body as? [String: Any],
              let requestID = body["id"] as? String,
              !requestID.isEmpty,
              requestID.count <= 64 else {
            return
        }
        guard let presenter else {
            reject(
                requestID: requestID,
                name: "InvalidStateError",
                message: "Native attachment picker is unavailable"
            )
            return
        }

        picker.present(from: presenter) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let file):
                if let file {
                    self.resolve(requestID: requestID, file: file)
                } else {
                    self.reject(
                        requestID: requestID,
                        name: "AbortError",
                        message: "User canceled"
                    )
                }
            case .failure(let error):
                self.reject(
                    requestID: requestID,
                    name: "OperationError",
                    message: error.localizedDescription
                )
            }
        }
    }
}
