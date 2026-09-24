import AVFoundation
import XCTest
@testable import Sudoku

final class NativeVideoExporterTests: XCTestCase {
    private func makeVideo(at url: URL, seconds: Int64 = 1) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 1920, AVVideoHeightKey: 1080,
        ])
        input.transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 1920, kCVPixelBufferHeightKey as String: 1080,
        ])
        writer.add(input)
        XCTAssertTrue(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            var frame = 0
            var completed = false
            input.requestMediaDataWhenReady(on: DispatchQueue(label: "test.video.writer")) {
                guard !completed else { return }
                while input.isReadyForMoreMediaData && frame < 2 {
                    var buffer: CVPixelBuffer?
                    guard let pool = adaptor.pixelBufferPool,
                          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
                          let buffer else {
                        completed = true; writer.cancelWriting()
                        continuation.resume(throwing: NativeVideoError.unsupported); return
                    }
                    CVPixelBufferLockBaseAddress(buffer, [])
                    if let address = CVPixelBufferGetBaseAddress(buffer) {
                        memset(address, frame == 0 ? 64 : 128, CVPixelBufferGetDataSize(buffer))
                    }
                    CVPixelBufferUnlockBaseAddress(buffer, [])
                    let time = frame == 0 ? CMTime.zero : CMTime(value: seconds * 30 - 1, timescale: 30)
                    guard adaptor.append(buffer, withPresentationTime: time) else {
                        completed = true; writer.cancelWriting()
                        continuation.resume(throwing: NativeVideoError.unsupported); return
                    }
                    frame += 1
                }
                if frame == 2 {
                    completed = true
                    input.markAsFinished()
                    writer.endSession(atSourceTime: CMTime(value: seconds, timescale: 1))
                    writer.finishWriting {
                        if writer.status == .completed { continuation.resume() }
                        else { continuation.resume(throwing: writer.error ?? NativeVideoError.unsupported) }
                    }
                }
            }
        }
    }

    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    @MainActor private func export(_ source: URL, output: URL, cancel: Bool = false) async -> Result<URL, Error> {
        let exporter = NativeVideoExporter()
        return await withCheckedContinuation { continuation in
            exporter.start(input: source, output: output) { result in
                withExtendedLifetime(exporter) { continuation.resume(returning: result) }
            }
            if cancel { exporter.cancel() }
        }
    }

    @MainActor func testExportsFullPortraitClipAt720p() async throws {
        let directory = try directory()
        let source = directory.appendingPathComponent("source.mov")
        try await makeVideo(at: source)
        let result = await export(source, output: directory.appendingPathComponent("result.mp4"))
        let url = try result.get()
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let naturalSize = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let size = naturalSize.applying(transform)
        XCTAssertGreaterThan(abs(size.height), abs(size.width))
        XCTAssertLessThanOrEqual(abs(size.width), 720)
        XCTAssertLessThanOrEqual(abs(size.height), 1280)
        let duration = try await asset.load(.duration)
        XCTAssertEqual(CMTimeGetSeconds(duration), 1, accuracy: 0.15)
        let bytes = try XCTUnwrap(url.resourceValues(forKeys: [.fileSizeKey]).fileSize)
        XCTAssertGreaterThan(bytes, 0)
        XCTAssertLessThanOrEqual(bytes, NativeVideoExporter.maxOutputBytes)
    }

    @MainActor func testRejectsLongClipWithoutExporting() async throws {
        let directory = try directory()
        let source = directory.appendingPathComponent("long.mov")
        try await makeVideo(at: source, seconds: 121)
        let output = directory.appendingPathComponent("result.mp4")
        let result = await export(source, output: output)
        guard case .failure(let error) = result, let videoError = error as? NativeVideoError,
              case .tooLong = videoError else { return XCTFail("Expected duration rejection") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    }

    @MainActor func testCancellationDoesNotReturnAMediaFile() async throws {
        let directory = try directory()
        let source = directory.appendingPathComponent("source.mov")
        try await makeVideo(at: source)
        let result = await export(source, output: directory.appendingPathComponent("result.mp4"), cancel: true)
        guard case .failure(let error) = result, let videoError = error as? NativeVideoError,
              case .cancelled = videoError else { return XCTFail("Expected cancellation") }
    }

    @MainActor func testRejectsOversizedSourceBeforeDecoding() async throws {
        let directory = try directory()
        let source = directory.appendingPathComponent("oversized.mov")
        FileManager.default.createFile(atPath: source.path, contents: Data())
        let file = try FileHandle(forWritingTo: source)
        try file.truncate(atOffset: UInt64(NativeVideoExporter.maxSourceBytes + 1))
        try file.close()
        let result = await export(source, output: directory.appendingPathComponent("result.mp4"))
        guard case .failure(let error) = result, let videoError = error as? NativeVideoError,
              case .tooLarge = videoError else { return XCTFail("Expected size rejection") }
    }
}
