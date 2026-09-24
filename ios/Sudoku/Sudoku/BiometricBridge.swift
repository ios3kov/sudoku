import Foundation
import WebKit

final class BiometricBridge: NSObject {
    static let handlerName = "sudokuBiometrics"
    static let readyEvent = "sudoku:native-biometrics-ready"

    private static let signedPayloadPrefix = "sudoku-biometric-unlock:v1:"
    private static let maximumSignedPayloadBytes = 512
    private static let challengeCharacters = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    )

    weak var webView: WKWebView?

    private static func isAllowedSignedPayload(_ payload: String) -> Bool {
        guard payload.hasPrefix(signedPayloadPrefix),
              payload.utf8.count <= maximumSignedPayloadBytes else {
            return false
        }

        let remainder = String(payload.dropFirst(signedPayloadPrefix.count))
        let parts = remainder.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2,
              UUID(uuidString: String(parts[0])) != nil else {
            return false
        }

        let challenge = String(parts[1])
        return challenge.utf8.count == 43
            && challenge.unicodeScalars.allSatisfy { challengeCharacters.contains($0) }
    }

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

    private func resolve(requestID: String, value: Any) {
        guard let webView else { return }
        DispatchQueue.main.async {
            webView.callAsyncJavaScript(
                "window.__sudokuNativeBiometricResolve(id, value);",
                arguments: [
                    "id": requestID,
                    "value": value,
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
                "window.__sudokuNativeBiometricReject(id, name, message);",
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

    private func reject(
        requestID: String,
        error: Error
    ) {
        let name: String
        let message: String

        switch error {
        case BiometricKeyStoreError.canceled:
            name = "AbortError"
            message = "Biometric authentication canceled"
        case BiometricKeyStoreError.noKey:
            name = "InvalidStateError"
            message = "Biometric credential is unavailable"
        case BiometricKeyStoreError.unavailable:
            name = "NotAllowedError"
            message = "Biometric authentication is unavailable"
        default:
            name = "OperationError"
            message = "Biometric operation failed"
        }

        reject(
            requestID: requestID,
            name: name,
            message: message
        )
    }

    private static let bridgeScript = #"""
    (() => {
      if (location.protocol !== "https:" || location.hostname !== "sudoku.moscow") return;

      const pending = new Map();
      let sequence = 0;

      const call = (operation, payload = {}) => new Promise((resolve, reject) => {
        const id = String(++sequence);
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.sudokuBiometrics.postMessage({
          id,
          operation,
          ...payload
        });
      });

      window.SudokuNativeBiometrics = {
        availability() {
          return call("availability");
        },
        enroll() {
          return call("enroll");
        },
        sign(payload) {
          return call("sign", { payload });
        },
        remove() {
          return call("remove");
        }
      };

      window.__sudokuNativeBiometricResolve = (id, value) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.resolve(value);
      };

      window.__sudokuNativeBiometricReject = (id, name, message) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new DOMException(message || "Biometric operation failed", name || "OperationError"));
      };

      window.dispatchEvent(new Event("sudoku:native-biometrics-ready"));
    })();
    """#
}

extension BiometricBridge: WKScriptMessageHandler {
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
              let operation = body["operation"] as? String else {
            return
        }

        switch operation {
        case "availability":
            resolve(
                requestID: requestID,
                value: BiometricKeyStore.shared.availability()
            )

        case "enroll":
            do {
                let publicKey = try BiometricKeyStore.shared.createCredential()
                resolve(
                    requestID: requestID,
                    value: ["publicKeyX963B64": publicKey]
                )
            } catch {
                reject(requestID: requestID, error: error)
            }

        case "sign":
            guard let payload = body["payload"] as? String,
                  Self.isAllowedSignedPayload(payload) else {
                reject(
                    requestID: requestID,
                    name: "DataError",
                    message: "Invalid biometric payload"
                )
                return
            }

            BiometricKeyStore.shared.sign(payload: payload) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let signature):
                    self.resolve(
                        requestID: requestID,
                        value: ["signatureB64": signature]
                    )
                case .failure(let error):
                    self.reject(requestID: requestID, error: error)
                }
            }

        case "remove":
            BiometricKeyStore.shared.deleteCredential()
            resolve(requestID: requestID, value: true)

        default:
            reject(
                requestID: requestID,
                name: "NotSupportedError",
                message: "Unsupported biometric operation"
            )
        }
    }
}
