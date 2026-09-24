import PhotosUI
import UIKit
import UniformTypeIdentifiers

struct NativePickedFile {
    let name: String
    let mimeType: String
    let data: Data
}

enum NativeMediaPickerError: LocalizedError {
    case busy
    case unreadable
    case unsupportedType
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .busy:
            return "Another picker is already open"
        case .unreadable:
            return "Unable to read the selected file"
        case .unsupportedType:
            return "This file type is not supported"
        case .tooLarge:
            return "Selected file is too large"
        }
    }
}

final class NativeMediaPicker: NSObject {
    typealias Completion = (Result<NativePickedFile?, Error>) -> Void

    static let maxBytes = 25 * 1024 * 1024

    private weak var presenter: UIViewController?
    private var completion: Completion?
    private var videoDirectory: URL?
    private var videoExporter: NativeVideoExporter?
    private var videoAlert: UIAlertController?
    private var videoJobID: UUID?
    private var videoLoadProgress: Progress?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(cancelVideoInBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func cancelVideoInBackground() {
        guard videoJobID != nil else { return }
        if let videoExporter { videoExporter.cancel() }
        else { finish(.success(nil)) }
    }

    private let allowedMimeTypes: Set<String> = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "application/pdf",
        "text/plain",
        "audio/mpeg",
        "audio/mp4",
        "audio/webm",
        "video/mp4",
        "video/webm",
        "video/quicktime",
    ]

    func present(
        from presenter: UIViewController,
        completion: @escaping Completion
    ) {
        guard self.completion == nil, presenter.presentedViewController == nil else {
            completion(.failure(NativeMediaPickerError.busy))
            return
        }

        self.presenter = presenter
        self.completion = completion

        let sheet = UIAlertController(
            title: "Attach",
            message: nil,
            preferredStyle: .actionSheet
        )
        sheet.addAction(
            UIAlertAction(title: "Photos and Videos", style: .default) { [weak self] _ in
                self?.presentPhotoPicker()
            }
        )
        sheet.addAction(
            UIAlertAction(title: "Files", style: .default) { [weak self] _ in
                self?.presentDocumentPicker()
            }
        )
        sheet.addAction(
            UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
                self?.finish(.success(nil))
            }
        )
        presenter.present(sheet, animated: true)
    }

    private func presentPhotoPicker() {
        guard let presenter else {
            finish(.failure(NativeMediaPickerError.unreadable))
            return
        }

        var configuration = PHPickerConfiguration()
        configuration.selectionLimit = 1
        configuration.filter = .any(of: [.images, .videos])
        configuration.preferredAssetRepresentationMode = .current

        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    private func presentDocumentPicker() {
        guard let presenter else {
            finish(.failure(NativeMediaPickerError.unreadable))
            return
        }

        var types: [UTType] = [
            .jpeg,
            .png,
            .gif,
            .webP,
            .pdf,
            .plainText,
            .mp3,
            .mpeg4Audio,
            .mpeg4Movie,
            .quickTimeMovie,
        ]
        if let webM = UTType(filenameExtension: "webm") {
            types.append(webM)
        }

        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: types,
            asCopy: true
        )
        picker.allowsMultipleSelection = false
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    private func pickedDocument(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let values = try url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
            if values.contentType?.conforms(to: .movie) == true {
                stageDocumentVideo(url)
                return
            }
            if let size = values.fileSize, size > Self.maxBytes {
                throw NativeMediaPickerError.tooLarge
            }

            guard let mimeType = values.contentType?.preferredMIMEType,
                  allowedMimeTypes.contains(mimeType) else {
                throw NativeMediaPickerError.unsupportedType
            }

            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            guard data.count <= Self.maxBytes else {
                throw NativeMediaPickerError.tooLarge
            }

            finish(
                .success(
                    NativePickedFile(
                        name: sanitizedName(url.lastPathComponent),
                        mimeType: mimeType,
                        data: data
                    )
                )
            )
        } catch {
            finish(.failure(error))
        }
    }

    private func finish(_ result: Result<NativePickedFile?, Error>) {
        videoJobID = nil
        videoLoadProgress?.cancel()
        videoLoadProgress = nil
        videoAlert?.dismiss(animated: true)
        videoAlert = nil
        videoExporter = nil
        if let videoDirectory { try? FileManager.default.removeItem(at: videoDirectory) }
        videoDirectory = nil
        let callback = completion
        completion = nil
        presenter = nil
        callback?(result)
    }

    // Copy provider-owned URLs before their access lifetime ends. Large source
    // videos stay on disk; only the <=25 MiB final file crosses the web bridge.
    private static func copyVideo(_ source: URL) throws -> URL {
        guard let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0, size <= NativeVideoExporter.maxSourceBytes else {
            throw NativeMediaPickerError.tooLarge
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sudoku-video-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.complete])
        let target = directory.appendingPathComponent("source").appendingPathExtension(source.pathExtension)
        do {
            try FileManager.default.copyItem(at: source, to: target)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
            return target
        }
        catch { try? FileManager.default.removeItem(at: directory); throw error }
    }

    private func stageDocumentVideo(_ url: URL) {
        let jobID = beginVideoLoading()
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let result = Result { try Self.copyVideo(url) }
            DispatchQueue.main.async { self.offerVideo(result, name: url.lastPathComponent, jobID: jobID) }
        }
    }

    private func beginVideoLoading() -> UUID {
        let jobID = UUID()
        videoJobID = jobID
        let alert = UIAlertController(title: "Loading video", message: "Preparing the selected file on this device.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finish(.success(nil)) })
        showVideoAlert(alert)
        return jobID
    }

    private func showVideoAlert(_ alert: UIAlertController, ready: (() -> Void)? = nil) {
        guard let presenter else { finish(.failure(NativeMediaPickerError.unreadable)); return }
        let previous = videoAlert
        videoAlert = alert
        let show = { [weak self] in
            guard self?.videoAlert === alert, self?.completion != nil else { return }
            alert.popoverPresentationController?.sourceView = presenter.view
            alert.popoverPresentationController?.sourceRect = presenter.view.bounds
            presenter.present(alert, animated: false, completion: ready)
        }
        if let previous, previous.presentingViewController != nil { previous.dismiss(animated: false, completion: show) }
        else { show() }
    }

    private func offerVideo(_ result: Result<URL, Error>, name: String, jobID: UUID) {
        guard videoJobID == jobID, completion != nil else {
            if case .success(let source) = result { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
            return
        }
        switch result {
        case .failure(let error): finish(.failure(error))
        case .success(let source):
            guard completion != nil, UIApplication.shared.applicationState != .background,
                  presenter != nil else {
                try? FileManager.default.removeItem(at: source.deletingLastPathComponent())
                finish(.success(nil)); return
            }
            videoDirectory = source.deletingLastPathComponent()
            let sheet = UIAlertController(title: "Video quality", message: "Standard: 720p, up to 2 minutes. Original: up to 25 MB.", preferredStyle: .actionSheet)
            sheet.addAction(UIAlertAction(title: "Standard", style: .default) { [weak self] _ in self?.exportVideo(source, name: name) })
            let original = UIAlertAction(title: "Original", style: .default) { [weak self] _ in self?.readVideo(source, name: name) }
            original.isEnabled = ((try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? Int.max) <= Self.maxBytes
            sheet.addAction(original)
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finish(.success(nil)) })
            showVideoAlert(sheet)
        }
    }

    private func exportVideo(_ source: URL, name: String) {
        guard let videoDirectory, let jobID = videoJobID else { finish(.failure(NativeMediaPickerError.unreadable)); return }
        let exporter = NativeVideoExporter()
        videoExporter = exporter
        let alert = UIAlertController(title: "Preparing video", message: "Keep the app open. You can cancel before sending.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in exporter.cancel() })
        showVideoAlert(alert)
        guard self.videoJobID == jobID else { return }
        exporter.start(input: source, output: videoDirectory.appendingPathComponent("prepared.mp4")) { [weak self] result in
            guard let self, self.videoJobID == jobID else { return }
            switch result {
            case .success(let url): self.readVideo(url, name: (name as NSString).deletingPathExtension + ".mp4")
            case .failure(let error):
                if let error = error as? NativeVideoError, case .cancelled = error { self.finish(.success(nil)) }
                else { self.finish(.failure(error)) }
            }
        }
    }

    private func readVideo(_ url: URL, name: String) {
        do {
            guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size > 0, size <= Self.maxBytes else { throw NativeMediaPickerError.tooLarge }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
            guard allowedMimeTypes.contains(mime), mime.hasPrefix("video/") else { throw NativeMediaPickerError.unsupportedType }
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            guard data.count <= Self.maxBytes else { throw NativeMediaPickerError.tooLarge }
            finish(.success(NativePickedFile(name: sanitizedName(name), mimeType: mime, data: data)))
        } catch { finish(.failure(error)) }
    }

    private func sanitizedName(_ raw: String) -> String {
        let cleaned = raw
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "attachment" : String(cleaned.prefix(180))
    }
}

extension NativeMediaPicker: PHPickerViewControllerDelegate {
    func picker(
        _ picker: PHPickerViewController,
        didFinishPicking results: [PHPickerResult]
    ) {
        guard let provider = results.first?.itemProvider else {
            picker.dismiss(animated: true)
            finish(.success(nil))
            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            // The provider deletes its temporary URL when this callback returns.
            picker.dismiss(animated: true) { [self] in
                let jobID = self.beginVideoLoading()
                self.videoLoadProgress = provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [self] url, error in
                    let result: Result<URL, Error>
                    if let url { result = Result { try Self.copyVideo(url) } }
                    else { result = .failure(error ?? NativeMediaPickerError.unreadable) }
                    DispatchQueue.main.async { self.offerVideo(result, name: provider.suggestedName ?? "video.mov", jobID: jobID) }
                }
            }
            return
        }
        picker.dismiss(animated: true)

        provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
            guard let self else { return }
            guard error == nil, let image = object as? UIImage,
                  let data = image.jpegData(compressionQuality: 0.92) else {
                DispatchQueue.main.async {
                    self.finish(.failure(error ?? NativeMediaPickerError.unreadable))
                }
                return
            }

            DispatchQueue.main.async {
                guard data.count <= Self.maxBytes else {
                    self.finish(.failure(NativeMediaPickerError.tooLarge))
                    return
                }

                let base = provider.suggestedName?
                    .replacingOccurrences(of: "/", with: "-")
                    .replacingOccurrences(of: "\\", with: "-")
                    .trimmingCharacters(in: .whitespacesAndNewlines)

                let name = (base?.isEmpty == false ? base! : "photo-\(Int(Date().timeIntervalSince1970))") + ".jpg"
                self.finish(
                    .success(
                        NativePickedFile(
                            name: String(name.prefix(180)),
                            mimeType: "image/jpeg",
                            data: data
                        )
                    )
                )
            }
        }
    }
}

extension NativeMediaPicker: UIDocumentPickerDelegate {
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(.success(nil))
    }

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let url = urls.first else {
            finish(.success(nil))
            return
        }
        controller.dismiss(animated: true) { [weak self] in self?.pickedDocument(url) }
    }
}
