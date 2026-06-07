import Foundation
import ScreenCaptureKit
import CoreGraphics
import AppKit

// Capture the iPhone Mirroring window
@available(macOS 14.0, *)
class MirrorCapture {

    static func run(outputPath: String) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        // Find iPhone Mirroring window
        var targetWindow: SCWindow?
        for window in content.windows {
            let app = window.owningApplication
            let title = window.title ?? ""
            let bundleId = app?.bundleIdentifier ?? ""

            if bundleId.contains("iPhoneMirroring") ||
               bundleId.contains("ScreenContinuity") ||
               title.contains("iPhone") {
                targetWindow = window
                break
            }
        }

        guard let window = targetWindow else {
            // List all windows for debugging
            fputs("No iPhone Mirroring window found. Available windows:\n", stderr)
            for w in content.windows {
                let app = w.owningApplication
                fputs("  [\(app?.bundleIdentifier ?? "?")] \(w.title ?? "untitled") (\(Int(w.frame.width))x\(Int(w.frame.height)))\n", stderr)
            }
            throw NSError(domain: "MirrorCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "iPhone Mirroring window not found"])
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width) * 2
        config.height = Int(window.frame.height) * 2
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

        let rep = NSBitmapImageRep(cgImage: image)
        guard let pngData = rep.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "MirrorCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "PNG encoding failed"])
        }

        try pngData.write(to: URL(fileURLWithPath: outputPath))
        print("OK:\(pngData.count):\(config.width)x\(config.height)")
    }
}

let args = CommandLine.arguments
if args.count < 2 {
    fputs("Usage: screen-mirror <output.png>\n       screen-mirror --list\n", stderr)
    exit(1)
}

if #available(macOS 14.0, *) {
    let semaphore = DispatchSemaphore(value: 0)

    if args[1] == "--list" {
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                for w in content.windows {
                    let app = w.owningApplication
                    print("\(app?.bundleIdentifier ?? "?")\t\(w.title ?? "untitled")\t\(Int(w.frame.width))x\(Int(w.frame.height))")
                }
            } catch {
                fputs("Error: \(error)\n", stderr)
            }
            semaphore.signal()
        }
        semaphore.wait()
    } else {
        Task {
            do {
                try await MirrorCapture.run(outputPath: args[1])
            } catch {
                fputs("Error: \(error)\n", stderr)
                exit(1)
            }
            semaphore.signal()
        }
        semaphore.wait()
    }
} else {
    fputs("Error: Requires macOS 14+\n", stderr)
    exit(1)
}
