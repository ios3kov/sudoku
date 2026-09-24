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
            UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in
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
        configuration.filter = .images
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
        let callback = completion
        completion = nil
        presenter = nil
        callback?(result)
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
        picker.dismiss(animated: true)

        guard let provider = results.first?.itemProvider else {
            finish(.success(nil))
            return
        }

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
        pickedDocument(url)
    }
}
