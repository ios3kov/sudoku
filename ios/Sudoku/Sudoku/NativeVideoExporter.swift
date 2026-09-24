import AVFoundation
import Foundation

enum NativeVideoError: LocalizedError {
    case unsupported, tooLong, tooLarge, incomplete, cancelled

    var errorDescription: String? {
        switch self {
        case .unsupported: return "Unable to prepare this video. Try another file or Original."
        case .tooLong: return "Standard video supports clips up to 2 minutes."
        case .tooLarge: return "Prepared video exceeds 25 MB. Choose a shorter clip."
        case .incomplete: return "Video preparation did not preserve the full clip. Choose a shorter clip."
        case .cancelled: return "Video preparation was canceled."
        }
    }
}

/// All methods and completion callbacks run on the main queue. Input/output
/// URLs belong to the picker; it removes them after reading the final result.
final class NativeVideoExporter {
    static let maxSourceBytes = 250 * 1024 * 1024
    static let maxOutputBytes = 25 * 1024 * 1024
    static let maxDuration: Double = 120

    private var asset: AVURLAsset?
    private var session: AVAssetExportSession?
    private var timeout: DispatchWorkItem?
    private var completion: ((Result<URL, Error>) -> Void)?
    private var cancelled = false
    private var started = false

    func start(input: URL, output: URL, completion: @escaping (Result<URL, Error>) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !started else { completion(.failure(NativeVideoError.unsupported)); return }
        started = true
        self.completion = completion
        guard !cancelled else { finish(.failure(NativeVideoError.cancelled)); return }
        guard let size = try? input.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0, size <= Self.maxSourceBytes else {
            finish(.failure(NativeVideoError.tooLarge)); return
        }
        let asset = AVURLAsset(url: input)
        self.asset = asset
        let deadline = DispatchWorkItem { [weak self] in self?.cancel() }
        timeout = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: deadline)
        asset.loadValuesAsynchronously(forKeys: ["duration", "tracks"]) { [weak self] in
            DispatchQueue.main.async { self?.exportLoaded(asset, output: output) }
        }
    }

    func cancel() {
        dispatchPrecondition(condition: .onQueue(.main))
        cancelled = true
        asset?.cancelLoading()
        if let session {
            // Wait for the export completion before the owner removes files.
            session.cancelExport()
        } else {
            finish(.failure(NativeVideoError.cancelled))
        }
    }

    private func exportLoaded(_ asset: AVURLAsset, output: URL) {
        guard completion != nil, !cancelled else { return }
        guard asset.statusOfValue(forKey: "duration", error: nil) == .loaded,
              asset.statusOfValue(forKey: "tracks", error: nil) == .loaded,
              let video = asset.tracks(withMediaType: .video).first else {
            finish(.failure(NativeVideoError.unsupported)); return
        }
        let duration = CMTimeGetSeconds(asset.duration)
        guard duration.isFinite, duration > 0, duration <= Self.maxDuration else {
            finish(.failure(NativeVideoError.tooLong)); return
        }
        let size = video.naturalSize
        guard size.width > 0, size.height > 0, size.width * size.height <= 33_554_432,
              let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720),
              exporter.supportedFileTypes.contains(.mp4) else {
            finish(.failure(NativeVideoError.unsupported)); return
        }
        session = exporter
        exporter.outputURL = output
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        exporter.metadata = []
        exporter.fileLengthLimit = Int64(Self.maxOutputBytes)
        exporter.exportAsynchronously { [weak self] in
            DispatchQueue.main.async {
                guard let self, self.completion != nil else { return }
                if self.cancelled || exporter.status == .cancelled {
                    self.finish(.failure(NativeVideoError.cancelled)); return
                }
                guard exporter.status == .completed else {
                    self.finish(.failure(NativeVideoError.unsupported)); return
                }
                self.validate(output, expectedDuration: duration,
                              expectsAudio: !asset.tracks(withMediaType: .audio).isEmpty)
            }
        }
    }

    private func validate(_ output: URL, expectedDuration: Double, expectsAudio: Bool) {
        guard let bytes = try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              bytes > 0, bytes <= Self.maxOutputBytes else {
            finish(.failure(NativeVideoError.tooLarge)); return
        }
        session = nil
        let result = AVURLAsset(url: output)
        asset = result
        result.loadValuesAsynchronously(forKeys: ["duration", "tracks"]) { [weak self] in
            DispatchQueue.main.async {
                guard let self, self.completion != nil else { return }
                if self.cancelled { self.finish(.failure(NativeVideoError.cancelled)); return }
                let duration = CMTimeGetSeconds(result.duration)
                guard result.statusOfValue(forKey: "duration", error: nil) == .loaded,
                      result.statusOfValue(forKey: "tracks", error: nil) == .loaded,
                      duration.isFinite, abs(duration - expectedDuration) <= 0.15,
                      !result.tracks(withMediaType: .video).isEmpty,
                      !expectsAudio || !result.tracks(withMediaType: .audio).isEmpty else {
                    self.finish(.failure(NativeVideoError.incomplete)); return
                }
                self.finish(.success(output))
            }
        }
    }

    private func finish(_ result: Result<URL, Error>) {
        timeout?.cancel()
        timeout = nil
        let callback = completion
        completion = nil
        session = nil
        asset = nil
        callback?(result)
    }
}
