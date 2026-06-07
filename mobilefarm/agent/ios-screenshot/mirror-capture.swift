import CoreGraphics
import Foundation

// Find iPhone Mirroring window and output its window ID
let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []

for w in windows {
    let owner = w["kCGWindowOwnerName"] as? String ?? ""
    let wid = w["kCGWindowNumber"] as? Int ?? 0
    let bounds = w["kCGWindowBounds"] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Int ?? 0
    let height = bounds["Height"] as? Int ?? 0

    if owner.contains("iPhone") || owner.contains("Видеоповтор") {
        if width > 100 && height > 100 {
            print("\(wid)")
            exit(0)
        }
    }
}

fputs("No iPhone Mirroring window found\n", stderr)
exit(1)
