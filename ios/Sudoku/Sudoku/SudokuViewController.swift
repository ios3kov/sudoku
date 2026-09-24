import Contacts
import ContactsUI
import UIKit
import WebKit

final class SudokuViewController: UIViewController {
    private static let canvasColor = UIColor(red: 244 / 255.0, green: 241 / 255.0, blue: 232 / 255.0, alpha: 1)
    private static let appURL = URL(string: "https://sudoku.moscow/")!
    private static let trustedHost = "sudoku.moscow"
    private static let contactHandlerName = "sudokuContacts"

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: Self.contactHandlerName)
        biometricBridge.install(into: controller)
        mediaBridge.install(into: controller)
        videoPlayback.install(into: controller)
        videoPlayback.presenter = self
        controller.addUserScript(
            WKUserScript(
                source: Self.contactBridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        // Compatibility with the currently hosted web release. New web styles
        // retain these rules; this can be removed after their production release.
        controller.addUserScript(WKUserScript(
            source: """
            if (location.protocol === "https:" && location.hostname === "sudoku.moscow") {
              const style = document.createElement("style");
              style.id = "sudoku-native-canvas";
              style.textContent = `
                .sudoku-reveal-screen::after { content:none !important; box-shadow:none !important; }
                .page,.shell { padding-bottom:max(10px,env(safe-area-inset-bottom)) !important; }
              `;
              document.head.appendChild(style);
            }
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        biometricBridge.webView = webView
        mediaBridge.webView = webView
        mediaBridge.presenter = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        // Prevent browser-style rubber banding without disabling nested chat
        // scrolling or the web app's deliberate hold-5 reveal gesture.
        if #available(iOS 26.0, *) {
            // This full-screen canvas has no overlaid native bars to separate
            // with UIKit's automatic scroll-edge shadows.
            webView.scrollView.topEdgeEffect.isHidden = true
            webView.scrollView.bottomEdgeEffect.isHidden = true
            webView.scrollView.leftEdgeEffect.isHidden = true
            webView.scrollView.rightEdgeEffect.isHidden = true
        }
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.isOpaque = false
        webView.backgroundColor = Self.canvasColor
        webView.scrollView.backgroundColor = Self.canvasColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    private let privacyCover = PrivacyCoverView()
    private let biometricBridge = BiometricBridge()
    private let mediaBridge = NativeMediaBridge()
    private let videoPlayback = NativeVideoPlayback()

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    func restorePortraitOrientation() {
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        } else {
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
    private var pendingContactRequestID: String?
    private var webContentLoaded = false

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = Self.canvasColor

        privacyCover.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(webView)
        view.addSubview(privacyCover)

        // Keep controls below the notch. Extend the web canvas under the home
        // indicator so each screen paints its own background without a seam.
        // Bottom control padding is supplied by CSS safe-area insets.
        let contentArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentArea.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentArea.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentArea.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            privacyCover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            privacyCover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            privacyCover.topAnchor.constraint(equalTo: view.topAnchor),
            privacyCover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        showPrivacyCover()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(updatePreferredTextSize),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )

        var request = URLRequest(url: Self.appURL)
        request.cachePolicy = .reloadRevalidatingCacheData
        request.timeoutInterval = 30
        webView.load(request)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Self.contactHandlerName
        )
        videoPlayback.uninstall(from: webView.configuration.userContentController)
        biometricBridge.uninstall(
            from: webView.configuration.userContentController
        )
        mediaBridge.uninstall(
            from: webView.configuration.userContentController
        )
    }

    func showPrivacyCover() {
        videoPlayback.cancel()
        webView.accessibilityElementsHidden = true
        privacyCover.isHidden = false
        view.bringSubviewToFront(privacyCover)
    }

    func hidePrivacyCoverAfterResume() {
        guard webContentLoaded else { return }
        updatePreferredTextSize()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self else { return }
            guard self.view.window?.windowScene?.activationState == .foregroundActive else { return }
            self.privacyCover.isHidden = true
            self.webView.accessibilityElementsHidden = false
        }
    }

    @objc private func updatePreferredTextSize() {
        guard webContentLoaded else { return }
        // Transfer only the system text scale; no message or account data.
        let size = UIFontMetrics(forTextStyle: .body).scaledValue(
            for: 16, compatibleWith: traitCollection
        )
        webView.callAsyncJavaScript(
            """
            if (location.protocol === "https:" && location.hostname === "sudoku.moscow") {
              document.documentElement.style.setProperty("--sudoku-text-size", percent + "%");
              window.dispatchEvent(new Event("sudoku:text-size-changed"));
            }
            """,
            arguments: ["percent": Double(size / 16 * 100)],
            in: nil,
            in: .page,
            completionHandler: nil
        )
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

        if navigationAction.targetFrame?.isMainFrame == true { videoPlayback.cancel() }

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
        guard message.name == Self.contactHandlerName else { return }
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

        presentContactPicker(requestID: requestID)
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
