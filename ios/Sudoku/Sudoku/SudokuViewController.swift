import Contacts
import ContactsUI
import UIKit
import WebKit

final class SudokuViewController: UIViewController {
    private static let appURL = URL(string: "https://sudoku.moscow/")!
    private static let trustedHost = "sudoku.moscow"
    private static let contactHandlerName = "sudokuContacts"
    private static let themeHandlerName = "sudokuTheme"

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: Self.contactHandlerName)
        controller.add(self, name: Self.themeHandlerName)
        hapticBridge.install(into: controller)
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
        webView.backgroundColor = SudokuNativePalette.gameBackground
        webView.scrollView.backgroundColor = SudokuNativePalette.gameBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    private let startupView = StartupView()
    private let privacyCover = PrivacyCoverView()
    private let hapticBridge = NativeHapticBridge()
    private let mediaBridge = NativeMediaBridge()
    private let videoPlayback = NativeVideoPlayback()
    private var lifecycleState = NativeLifecycleState()
    private var currentSurface: NativeSurface = .sudoku

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        if lifecycleState.startupVisible || lifecycleState.privacyVisible {
            return .lightContent
        }
        return NativeSurfacePolicy.statusBarStyle(for: currentSurface)
    }

    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

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

        view.backgroundColor = NativeSurfacePolicy.background(for: currentSurface)

        startupView.translatesAutoresizingMaskIntoConstraints = false
        privacyCover.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(webView)
        view.addSubview(startupView)
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

            startupView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            startupView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            startupView.topAnchor.constraint(equalTo: view.topAnchor),
            startupView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            privacyCover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            privacyCover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            privacyCover.topAnchor.constraint(equalTo: view.topAnchor),
            privacyCover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        renderLifecycle(animatedStartup: false)

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
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Self.themeHandlerName
        )
        videoPlayback.uninstall(from: webView.configuration.userContentController)
        hapticBridge.uninstall(from: webView.configuration.userContentController)
        mediaBridge.uninstall(
            from: webView.configuration.userContentController
        )
    }

    private func renderLifecycle(animatedStartup: Bool) {
        let showStartup = lifecycleState.startupVisible
        let showPrivacy = lifecycleState.privacyVisible

        webView.accessibilityElementsHidden = showStartup || showPrivacy

        if showStartup {
            startupView.layer.removeAllAnimations()
            startupView.alpha = 1
            startupView.isHidden = false
        } else if !startupView.isHidden {
            let finish = { [weak self] in
                self?.startupView.alpha = 0
                self?.startupView.isHidden = true
            }
            if animatedStartup {
                UIView.animate(
                    withDuration: 0.18,
                    delay: 0,
                    options: [.beginFromCurrentState, .curveEaseOut],
                    animations: { [weak self] in self?.startupView.alpha = 0 },
                    completion: { _ in finish() }
                )
            } else {
                finish()
            }
        }

        privacyCover.layer.removeAllAnimations()
        privacyCover.isHidden = !showPrivacy
        privacyCover.alpha = 1
        if showPrivacy {
            view.bringSubviewToFront(privacyCover)
        } else if showStartup {
            view.bringSubviewToFront(startupView)
        }

        setNeedsStatusBarAppearanceUpdate()
    }

    func showPrivacyCover() {
        videoPlayback.cancel()
        lifecycleState.apply(.willResignActive)
        renderLifecycle(animatedStartup: false)
    }

    func hidePrivacyCoverAfterResume() {
        lifecycleState.apply(.didBecomeActive)
        if webContentLoaded {
            updatePreferredTextSize()
        }
        renderLifecycle(animatedStartup: false)
    }

    func didEnterBackground() {
        videoPlayback.cancel()
        lifecycleState.apply(.didEnterBackground)
        renderLifecycle(animatedStartup: false)
    }

    private func applySurface(_ surface: NativeSurface) {
        guard surface != currentSurface else { return }
        currentSurface = surface
        let background = NativeSurfacePolicy.background(for: surface)
        view.backgroundColor = background
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        setNeedsStatusBarAppearanceUpdate()
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

    private func contactsAuthorizationStatus() -> String {
        NativeContactsPolicy.name(
            for: CNContactStore.authorizationStatus(for: .contacts)
        )
    }

    private func resolveContactValue(requestID: String, value: Any) {
        webView.callAsyncJavaScript(
            "window.__sudokuNativeContactsResolve(id, value);",
            arguments: [
                "id": requestID,
                "value": value,
            ],
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


    private func requestAllContacts(requestID: String) {
        guard pendingContactRequestID == nil else {
            rejectContactRequest(requestID: requestID, message: "A Contacts request is already open")
            return
        }

        pendingContactRequestID = requestID
        let store = CNContactStore()
        store.requestAccess(for: .contacts) { [weak self] granted, error in
            guard let self else { return }

            guard granted, error == nil else {
                DispatchQueue.main.async {
                    guard self.pendingContactRequestID == requestID else { return }
                    self.pendingContactRequestID = nil
                    self.rejectContactRequest(
                        requestID: requestID,
                        message: "Contacts access was not granted"
                    )
                }
                return
            }

            let keys: [CNKeyDescriptor] = [
                CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
                CNContactPhoneNumbersKey as CNKeyDescriptor,
            ]
            let request = CNContactFetchRequest(keysToFetch: keys)
            var contacts: [CNContact] = []

            do {
                try store.enumerateContacts(with: request) { contact, _ in
                    if !contact.phoneNumbers.isEmpty {
                        contacts.append(contact)
                    }
                }
                DispatchQueue.main.async {
                    guard self.pendingContactRequestID == requestID else { return }
                    self.resolveContacts(contacts)
                }
            } catch {
                DispatchQueue.main.async {
                    guard self.pendingContactRequestID == requestID else { return }
                    self.pendingContactRequestID = nil
                    self.rejectContactRequest(
                        requestID: requestID,
                        message: "Unable to read Contacts"
                    )
                }
            }
        }
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

      const request = (action) => new Promise((resolve, reject) => {
        const id = String(++sequence);
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.sudokuContacts.postMessage({ id, action });
      });

      window.SudokuNativeContacts = {
        select() {
          return request("select");
        },
        all() {
          return request("all");
        },
        status() {
          return request("status");
        }
      };

      window.__sudokuNativeContactsResolve = (id, value) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        item.resolve(value);
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
        lifecycleState.apply(.webLoaded)
        updatePreferredTextSize()
        renderLifecycle(animatedStartup: true)
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
        guard message.frameInfo.isMainFrame else { return }
        guard let sourceURL = message.frameInfo.request.url,
              sourceURL.scheme == "https",
              sourceURL.host == Self.trustedHost else {
            return
        }

        if message.name == Self.themeHandlerName {
            guard let body = message.body as? [String: Any],
                  let rawSurface = body["surface"] as? String,
                  let surface = NativeSurface(rawValue: rawSurface) else {
                return
            }
            applySurface(surface)
            return
        }

        guard message.name == Self.contactHandlerName,
              let body = message.body as? [String: Any],
              let requestID = body["id"] as? String,
              !requestID.isEmpty else {
            return
        }

        switch body["action"] as? String {
        case "all":
            requestAllContacts(requestID: requestID)
        case "status":
            resolveContactValue(
                requestID: requestID,
                value: contactsAuthorizationStatus()
            )
        default:
            presentContactPicker(requestID: requestID)
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
