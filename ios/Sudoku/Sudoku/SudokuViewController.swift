import Contacts
import ContactsUI
import LocalAuthentication
import UIKit
import WebKit

final class SudokuViewController: UIViewController {
    private static let appURL = URL(string: "https://sudoku.moscow/")!
    private static let trustedHost = "sudoku.moscow"
    private static let contactHandlerName = "sudokuContacts"
    private static let biometricHandlerName = "sudokuBiometric"
    private static let mediaHandlerName = "sudokuMedia"

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: Self.contactHandlerName)
        controller.add(self, name: Self.biometricHandlerName)
        controller.add(self, name: Self.mediaHandlerName)
        for source in [
            Self.contactBridgeScript,
            Self.biometricBridgeScript,
            Self.mediaBridgeScript,
        ] {
            controller.addUserScript(
                WKUserScript(
                    source: source,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    private let privacyCover = PrivacyCoverView()
    private let biometricPinVault = BiometricPinVault()
    private let mediaPicker = NativeMediaPicker()
    private var pendingContactRequestID: String?
    private var pendingMediaRequestID: String?
    private var webContentLoaded = false

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = UIColor(red: 0.969, green: 0.961, blue: 0.937, alpha: 1)

        privacyCover.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(webView)
        view.addSubview(privacyCover)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            privacyCover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            privacyCover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            privacyCover.topAnchor.constraint(equalTo: view.topAnchor),
            privacyCover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        showPrivacyCover()

        var request = URLRequest(url: Self.appURL)
        request.cachePolicy = .reloadRevalidatingCacheData
        request.timeoutInterval = 30
        webView.load(request)
    }

    deinit {
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: Self.contactHandlerName)
        controller.removeScriptMessageHandler(forName: Self.biometricHandlerName)
        controller.removeScriptMessageHandler(forName: Self.mediaHandlerName)
    }

    func showPrivacyCover() {
        privacyCover.isHidden = false
        view.bringSubviewToFront(privacyCover)
    }

    func hidePrivacyCoverAfterResume() {
        guard webContentLoaded else { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self else { return }
            guard self.view.window?.windowScene?.activationState == .foregroundActive else { return }
            self.privacyCover.isHidden = true
        }
    }

    private func presentContactPicker(requestID: String) {
        guard pendingContactRequestID == nil, presentedViewController == nil else {
            rejectContactRequest(requestID: requestID, message: "Contact picker is already open")
            return
        }

        pendingContactRequestID = requestID

        let picker = CNContactPickerViewController()
        picker.delegate = self
        picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
        picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
        present(picker, animated: true)
    }

    private func resolveContacts(_ contacts: [CNContact]) {
        guard let requestID = pendingContactRequestID else { return }
        pendingContactRequestID = nil

        let payload: [[String: Any]] = contacts.compactMap { contact in
            let phones = contact.phoneNumbers.map { $0.value.stringValue }
            guard !phones.isEmpty else { return nil }

            let fullName = CNContactFormatter.string(from: contact, style: .fullName) ?? ""
            let names = fullName.isEmpty ? [] : [fullName]

            return [
                "name": names,
                "tel": phones,
            ]
        }

        webView.callAsyncJavaScript(
            "window.__sudokuNativeContactsResolve(id, contacts);",
            arguments: [
                "id": requestID,
                "contacts": payload,
            ],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func cancelContactRequest() {
        guard let requestID = pendingContactRequestID else { return }
        pendingContactRequestID = nil

        webView.callAsyncJavaScript(
            "window.__sudokuNativeContactsCancel(id);",
            arguments: ["id": requestID],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func rejectContactRequest(requestID: String, message: String) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeContactsReject(id, message);",
            arguments: [
                "id": requestID,
                "message": message,
            ],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func handleBiometricRequest(
        requestID: String,
        operation: String,
        body: [String: Any]
    ) {
        switch operation {
        case "status":
            resolveBiometric(requestID: requestID, status: biometricPinVault.status())

        case "enroll":
            guard let pin = body["pin"] as? String else {
                rejectBiometric(requestID: requestID, message: "Missing PIN")
                return
            }
            do {
                try biometricPinVault.store(pin: pin)
                resolveBiometric(requestID: requestID, status: biometricPinVault.status())
            } catch {
                rejectBiometric(
                    requestID: requestID,
                    message: error.localizedDescription
                )
            }

        case "clear":
            biometricPinVault.clear()
            resolveBiometric(requestID: requestID, status: biometricPinVault.status())

        case "unlock":
            biometricPinVault.unlock(reason: "Unlock private messages") { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    switch result {
                    case .success(let pin):
                        self.webView.callAsyncJavaScript(
                            "window.__sudokuNativeBiometricResolve(id, value);",
                            arguments: [
                                "id": requestID,
                                "value": ["pin": pin],
                            ],
                            in: nil,
                            in: .page,
                            completionHandler: nil
                        )
                    case .failure(let error):
                        if let laError = error as? LAError,
                           [.userCancel, .appCancel, .systemCancel, .userFallback]
                            .contains(laError.code) {
                            self.cancelBiometric(requestID: requestID)
                        } else {
                            self.rejectBiometric(
                                requestID: requestID,
                                message: error.localizedDescription
                            )
                        }
                    }
                }
            }

        default:
            rejectBiometric(requestID: requestID, message: "Unsupported biometric operation")
        }
    }

    private func resolveBiometric(
        requestID: String,
        status: BiometricPinVault.Status
    ) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeBiometricResolve(id, value);",
            arguments: [
                "id": requestID,
                "value": [
                    "available": status.available,
                    "enrolled": status.enrolled,
                    "type": status.type,
                ],
            ],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func cancelBiometric(requestID: String) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeBiometricCancel(id);",
            arguments: ["id": requestID],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func rejectBiometric(requestID: String, message: String) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeBiometricReject(id, message);",
            arguments: [
                "id": requestID,
                "message": message,
            ],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func presentMediaPicker(requestID: String) {
        guard pendingMediaRequestID == nil else {
            rejectMedia(requestID: requestID, message: "Attachment picker is already open")
            return
        }

        pendingMediaRequestID = requestID
        mediaPicker.present(from: self) { [weak self] result in
            guard let self else { return }
            guard self.pendingMediaRequestID == requestID else { return }
            self.pendingMediaRequestID = nil

            switch result {
            case .success(.none):
                self.cancelMedia(requestID: requestID)
            case .success(.some(let file)):
                self.webView.callAsyncJavaScript(
                    "window.__sudokuNativeMediaResolve(id, value);",
                    arguments: [
                        "id": requestID,
                        "value": [
                            "name": file.name,
                            "mimeType": file.mimeType,
                            "size": file.data.count,
                            "base64": file.data.base64EncodedString(),
                        ],
                    ],
                    in: nil,
                    in: .page,
                    completionHandler: nil
                )
            case .failure(let error):
                self.rejectMedia(
                    requestID: requestID,
                    message: error.localizedDescription
                )
            }
        }
    }

    private func cancelMedia(requestID: String) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeMediaCancel(id);",
            arguments: ["id": requestID],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func rejectMedia(requestID: String, message: String) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeMediaReject(id, message);",
            arguments: [
                "id": requestID,
                "message": message,
            ],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private static let contactBridgeScript = #"""
    (() => {
      if (location.protocol !== "https:" || location.hostname !== "sudoku.moscow") return;

      const pending = new Map();
      let sequence = 0;

      window.SudokuNativeContacts = {
        select() {
          return new Promise((resolve, reject) => {
            const id = String(++sequence);
            pending.set(id, { resolve, reject });
            window.webkit.messageHandlers.sudokuContacts.postMessage({ id });
          });
        }
      };

      window.__sudokuNativeContactsResolve = (id, contacts) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.resolve(Array.isArray(contacts) ? contacts : []);
      };

      window.__sudokuNativeContactsCancel = (id) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new DOMException("User canceled", "AbortError"));
      };

      window.__sudokuNativeContactsReject = (id, message) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new Error(message || "Native contacts failed"));
      };

      window.dispatchEvent(new Event("sudoku:native-contacts-ready"));
    })();
    """#


    private static let biometricBridgeScript = #"""
    (() => {
      if (location.protocol !== "https:" || location.hostname !== "sudoku.moscow") return;

      const pending = new Map();
      let sequence = 0;
      const call = (op, extra = {}) => new Promise((resolve, reject) => {
        const id = String(++sequence);
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.sudokuBiometric.postMessage({ id, op, ...extra });
      });

      window.SudokuNativeBiometric = {
        status() { return call("status"); },
        enroll(pin) { return call("enroll", { pin }); },
        clear() { return call("clear"); },
        unlock() { return call("unlock"); }
      };

      window.__sudokuNativeBiometricResolve = (id, value) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.resolve(value);
      };

      window.__sudokuNativeBiometricCancel = (id) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new DOMException("User canceled", "AbortError"));
      };

      window.__sudokuNativeBiometricReject = (id, message) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new Error(message || "Biometric unlock failed"));
      };

      window.dispatchEvent(new Event("sudoku:native-biometric-ready"));
    })();
    """#

    private static let mediaBridgeScript = #"""
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

      window.__sudokuNativeMediaCancel = (id) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new DOMException("User canceled", "AbortError"));
      };

      window.__sudokuNativeMediaReject = (id, message) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.reject(new Error(message || "Native attachment picker failed"));
      };

      window.dispatchEvent(new Event("sudoku:native-media-ready"));
    })();
    """#
}

extension SudokuViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webContentLoaded = true
        hidePrivacyCoverAfterResume()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "https", url.host == Self.trustedHost {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme,
           ["https", "mailto", "tel"].contains(scheme) {
            UIApplication.shared.open(url)
        }

        decisionHandler(.cancel)
    }
}

extension SudokuViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url,
           url.scheme == "https",
           url.host == Self.trustedHost {
            webView.load(URLRequest(url: url))
        } else if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

extension SudokuViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.frameInfo.isMainFrame else { return }
        guard let sourceURL = message.frameInfo.request.url,
              sourceURL.scheme == "https",
              sourceURL.host == Self.trustedHost else {
            return
        }
        guard let body = message.body as? [String: Any],
              let requestID = body["id"] as? String,
              !requestID.isEmpty else {
            return
        }

        switch message.name {
        case Self.contactHandlerName:
            presentContactPicker(requestID: requestID)

        case Self.biometricHandlerName:
            guard let operation = body["op"] as? String else {
                rejectBiometric(requestID: requestID, message: "Missing biometric operation")
                return
            }
            handleBiometricRequest(
                requestID: requestID,
                operation: operation,
                body: body
            )

        case Self.mediaHandlerName:
            presentMediaPicker(requestID: requestID)

        default:
            return
        }
    }
}

extension SudokuViewController: CNContactPickerDelegate {
    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        cancelContactRequest()
    }

    func contactPicker(
        _ picker: CNContactPickerViewController,
        didSelect contacts: [CNContact]
    ) {
        resolveContacts(contacts)
    }

    func contactPicker(
        _ picker: CNContactPickerViewController,
        didSelect contact: CNContact
    ) {
        resolveContacts([contact])
    }
}
