import AVKit
import WebKit

/// A full-screen container rather than an AVPlayerViewController subclass.
final class NativeVideoPlayerController: UIViewController {
    let landscape: Bool
    var onClose: (() -> Void)?
    private let playerController = AVPlayerViewController()

    init(url: URL, landscape: Bool) {
        self.landscape = landscape
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        playerController.player = AVPlayer(url: url)
        playerController.allowsPictureInPicturePlayback = false
        playerController.player?.allowsExternalPlayback = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { landscape ? .allButUpsideDown : .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(playerController)
        playerController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(playerController.view)
        playerController.didMove(toParent: self)
        let close = UIButton(type: .system)
        close.setTitle("Close video", for: .normal)
        close.tintColor = .white
        close.titleLabel?.font = UIFont.preferredFont(forTextStyle: .body)
        close.titleLabel?.adjustsFontForContentSizeCategory = true
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(closeVideo), for: .touchUpInside)
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            playerController.view.topAnchor.constraint(equalTo: close.bottomAnchor),
            playerController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            playerController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            playerController.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
    }

    @objc private func closeVideo() { onClose?() }
    func stop() {
        playerController.player?.pause()
        playerController.player?.replaceCurrentItem(with: nil)
    }
}

final class NativeVideoPlayback: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "sudokuVideoPlayback"
    static let maxBytes = 25 * 1024 * 1024
    weak var presenter: SudokuViewController?
    private var reply: ((Any?, String?) -> Void)?
    private var directory: URL?
    private var asset: AVURLAsset?
    private var player: NativeVideoPlayerController?
    private var requestID: String?
    private var generation = 0
    private var deadline: DispatchWorkItem?

    func install(into controller: WKUserContentController) {
        controller.addScriptMessageHandler(self, contentWorld: .page, name: Self.handlerName)
        controller.addUserScript(WKUserScript(source: #"""
        if (location.protocol === "https:" && location.hostname === "sudoku.moscow") {
          window.SudokuNativeVideo = {
            play: payload => window.webkit.messageHandlers.sudokuVideoPlayback.postMessage(payload),
            stop: id => window.webkit.messageHandlers.sudokuVideoPlayback.postMessage({action: "stop", id})
          };
        }
        """#, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func uninstall(from controller: WKUserContentController) {
        cancel()
        controller.removeScriptMessageHandler(forName: Self.handlerName, contentWorld: .page)
    }

    static func decode(_ body: Any) throws -> (Data, String) {
        guard let payload = body as? [String: Any],
              let mime = payload["mimeType"] as? String,
              let ext = ["video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"][mime],
              let base64 = payload["base64"] as? String,
              !base64.isEmpty, base64.utf8.count <= ((maxBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= maxBytes else {
            throw NativeVideoError.unsupported
        }
        return (data, ext)
    }

    static func isLandscape(_ size: CGSize, transform: CGAffineTransform) -> Bool {
        let displayed = size.applying(transform)
        return abs(displayed.width) > abs(displayed.height)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == Self.handlerName, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, url.scheme == "https", url.host == "sudoku.moscow",
              let payload = message.body as? [String: Any],
              let id = payload["id"] as? String, !id.isEmpty, id.count <= 64 else {
            replyHandler(nil, "Video playback unavailable"); return
        }
        if payload["action"] as? String == "stop" {
            if requestID == id { cancel() }
            replyHandler(true, nil); return
        }
        guard UIApplication.shared.applicationState == .active,
              reply == nil, let presenter, presenter.presentedViewController == nil else {
            replyHandler(nil, "Another viewer is open"); return
        }
        do {
            let (data, ext) = try Self.decode(message.body)
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sudoku-playback-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                   attributes: [.protectionKey: FileProtectionType.complete])
            self.directory = directory
            let file = directory.appendingPathComponent("video").appendingPathExtension(ext)
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            requestID = id
            reply = replyHandler
            generation += 1
            let current = generation
            let asset = AVURLAsset(url: file)
            self.asset = asset
            let timeout = DispatchWorkItem { [weak self] in self?.cancel(error: "Unable to open video") }
            deadline = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            asset.loadValuesAsynchronously(forKeys: ["tracks", "playable"]) { [weak self] in
                DispatchQueue.main.async {
                    guard let self, self.generation == current, self.reply != nil else { return }
                    self.deadline?.cancel(); self.deadline = nil
                    guard asset.statusOfValue(forKey: "tracks", error: nil) == .loaded,
                          asset.statusOfValue(forKey: "playable", error: nil) == .loaded, asset.isPlayable,
                          let track = asset.tracks(withMediaType: .video).first,
                          UIApplication.shared.applicationState == .active,
                          presenter.presentedViewController == nil else {
                        self.cancel(error: "This video cannot be played on this device"); return
                    }
                    let player = NativeVideoPlayerController(url: file, landscape: Self.isLandscape(track.naturalSize, transform: track.preferredTransform))
                    player.onClose = { [weak self] in self?.cancel() }
                    self.player = player
                    presenter.present(player, animated: true)
                }
            }
        } catch {
            if let directory { try? FileManager.default.removeItem(at: directory) }
            directory = nil
            replyHandler(nil, "Unable to open video")
        }
    }

    func cancel(error: String? = nil) {
        generation += 1
        deadline?.cancel(); deadline = nil
        asset?.cancelLoading(); asset = nil
        player?.stop()
        player?.dismiss(animated: false)
        player = nil
        presenter?.restorePortraitOrientation()
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        requestID = nil
        let callback = reply; reply = nil
        callback?(error == nil ? true : nil, error)
    }
}
