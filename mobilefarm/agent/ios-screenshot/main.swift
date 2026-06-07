import AVFoundation
import CoreMediaIO
import AppKit
import Foundation

func enableScreenCapture() {
    var prop = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
    )
    var allow: UInt32 = 1
    CMIOObjectSetPropertyData(
        CMIOObjectID(kCMIOObjectSystemObject),
        &prop, 0, nil,
        UInt32(MemoryLayout<UInt32>.size), &allow
    )
}

class ScreenshotCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let outputPath: String
    var captured = false
    let semaphore = DispatchSemaphore(value: 0)
    var frameCount = 0

    init(outputPath: String) {
        self.outputPath = outputPath
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameCount += 1
        // Skip first few frames (may be blank/transitional)
        guard frameCount >= 3 && !captured else { return }
        captured = true

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            fputs("Error: No pixel buffer\n", stderr)
            semaphore.signal()
            return
        }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)

        guard let cgImage = context.createCGImage(ciImage, from: CGRect(x: 0, y: 0, width: w, height: h)) else {
            fputs("Error: CGImage creation failed\n", stderr)
            semaphore.signal()
            return
        }

        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let pngData = rep.representation(using: .png, properties: [:]) else {
            fputs("Error: PNG encoding failed\n", stderr)
            semaphore.signal()
            return
        }

        do {
            try pngData.write(to: URL(fileURLWithPath: outputPath))
            print("OK:\(pngData.count):\(w)x\(h)")
        } catch {
            fputs("Error: \(error)\n", stderr)
        }
        semaphore.signal()
    }
}

enableScreenCapture()
Thread.sleep(forTimeInterval: 0.5)

let args = CommandLine.arguments

if args.count >= 2 && args[1] == "--list" {
    let session = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.external],
        mediaType: .video,
        position: .unspecified
    )
    for d in session.devices {
        let transport = d.transportType
        let tid = String(format: "0x%08X", transport)
        print("\(d.uniqueID)\t\(d.localizedName)\t\(d.modelID)\t\(d.manufacturer)\ttransport=\(tid)")
    }

    let muxedSession = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.external, .builtInWideAngleCamera],
        mediaType: .muxed,
        position: .unspecified
    )
    for d in muxedSession.devices where d.manufacturer == "Apple Inc." {
        let transport = d.transportType
        let tid = String(format: "0x%08X", transport)
        print("MUXED:\(d.uniqueID)\t\(d.localizedName)\t\(d.modelID)\t\(d.manufacturer)\ttransport=\(tid)")
    }
    exit(0)
}

if args.count < 2 {
    fputs("Usage: ios-screenshot <output.png> [device-id]\n       ios-screenshot --list\n", stderr)
    exit(1)
}

let outputPath = args[1]
let targetId = args.count > 2 ? args[2] : nil

// Find external video devices (iOS screen mirrors appear here after enabling screen capture)
let discoverySession = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.external],
    mediaType: .video,
    position: .unspecified
)

var device: AVCaptureDevice?
for d in discoverySession.devices {
    if let targetId = targetId {
        if d.uniqueID.contains(targetId) {
            device = d
            break
        }
    } else if d.manufacturer == "Apple Inc." {
        device = d
        break
    }
}

// Also try muxed devices
if device == nil {
    let muxedSession = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.external],
        mediaType: .muxed,
        position: .unspecified
    )
    for d in muxedSession.devices {
        if let targetId = targetId {
            if d.uniqueID.contains(targetId) {
                device = d
                break
            }
        } else if d.manufacturer == "Apple Inc." {
            device = d
            break
        }
    }
}

guard let captureDevice = device else {
    fputs("Error: No iOS device found. Available devices:\n", stderr)
    for d in discoverySession.devices {
        fputs("  \(d.uniqueID) - \(d.localizedName) (\(d.modelID))\n", stderr)
    }
    exit(1)
}

fputs("Using device: \(captureDevice.localizedName) (\(captureDevice.uniqueID))\n", stderr)

let session = AVCaptureSession()
session.sessionPreset = .high

guard let input = try? AVCaptureDeviceInput(device: captureDevice) else {
    fputs("Error: Cannot create capture input\n", stderr)
    exit(1)
}
session.addInput(input)

let output = AVCaptureVideoDataOutput()
output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
output.alwaysDiscardsLateVideoFrames = true

let delegate = ScreenshotCapture(outputPath: outputPath)
let queue = DispatchQueue(label: "capture")
output.setSampleBufferDelegate(delegate, queue: queue)
session.addOutput(output)

session.startRunning()

let result = delegate.semaphore.wait(timeout: .now() + 15)
session.stopRunning()

if result == .timedOut {
    fputs("Error: Timeout (\(delegate.frameCount) frames received)\n", stderr)
    exit(1)
}
exit(0)
