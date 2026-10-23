// macOS asset generator. Uses CoreGraphics and ImageIO, without third-party packages.
// Usage: swift scripts/generate-icons.swift [path/to/source.png]
import Foundation
import CoreGraphics
import ImageIO

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1])
    : root.appendingPathComponent("assets/logo-source.png")
let files = FileManager.default
try files.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
try files.createDirectory(at: root.appendingPathComponent("icons"), withIntermediateDirectories: true)

guard let input = CGImageSourceCreateWithURL(source as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(input, 0, nil) else {
    fatalError("Cannot read the source logo.")
}
let width = image.width, height = image.height
let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
let colorSpace = CGColorSpaceCreateDeviceRGB()
var pixels = [UInt8](repeating: 0, count: width * height * 4)
pixels.withUnsafeMutableBytes { data in
    let context = CGContext(data: data.baseAddress, width: width, height: height,
                            bitsPerComponent: 8, bytesPerRow: width * 4,
                            space: colorSpace, bitmapInfo: bitmapInfo)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
}

// Retain the largest connected alpha component. This removes stray export pixels
// without changing the shape, gradient, or antialiased edges of the main mark.
var visited = [Bool](repeating: false, count: width * height)
var largest = [Int]()
for start in 0..<(width * height) where !visited[start] && pixels[start * 4 + 3] >= 4 {
    var queue = [start]
    visited[start] = true
    var cursor = 0
    while cursor < queue.count {
        let current = queue[cursor]
        cursor += 1
        let x = current % width, y = current / width
        var neighbors = [Int]()
        if x > 0 { neighbors.append(current - 1) }
        if x + 1 < width { neighbors.append(current + 1) }
        if y > 0 { neighbors.append(current - width) }
        if y + 1 < height { neighbors.append(current + width) }
        for next in neighbors where !visited[next] && pixels[next * 4 + 3] >= 4 {
            visited[next] = true
            queue.append(next)
        }
    }
    if queue.count > largest.count { largest = queue }
}
guard !largest.isEmpty else { fatalError("The logo contains no visible pixels.") }
var mask = [Bool](repeating: false, count: width * height)
var left = width, top = height, right = 0, bottom = 0
for index in largest {
    mask[index] = true
    left = min(left, index % width); right = max(right, index % width)
    top = min(top, index / width); bottom = max(bottom, index / width)
}
for index in 0..<(width * height) where !mask[index] {
    for channel in 0..<4 { pixels[index * 4 + channel] = 0 }
}
let data = Data(pixels) as CFData
let provider = CGDataProvider(data: data)!
let cleaned = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                      bytesPerRow: width * 4, space: colorSpace,
                      bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo), provider: provider,
                      decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
let crop = CGRect(x: max(0, left - 2), y: max(0, top - 2),
                  width: min(width, right + 3) - max(0, left - 2),
                  height: min(height, bottom + 3) - max(0, top - 2))
let mark = cleaned.cropping(to: crop)!

func render(_ width: Int, _ height: Int, padding: CGFloat = 0) -> CGImage {
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: width * 4, space: colorSpace, bitmapInfo: bitmapInfo)!
    context.interpolationQuality = .high
    let scale = min((CGFloat(width) - padding * 2) / CGFloat(mark.width),
                    (CGFloat(height) - padding * 2) / CGFloat(mark.height))
    let w = CGFloat(mark.width) * scale, h = CGFloat(mark.height) * scale
    context.draw(mark, in: CGRect(x: (CGFloat(width) - w) / 2, y: (CGFloat(height) - h) / 2, width: w, height: h))
    return context.makeImage()!
}
func save(_ image: CGImage, _ path: String) {
    let output = root.appendingPathComponent(path)
    let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot write \(path).") }
    let bytes = (try? Data(contentsOf: output).count) ?? 0
    print("\(path): \(image.width)×\(image.height), \(bytes) bytes")
}
let sourceWidth = min(512, mark.width)
let sourceHeight = Int((Double(mark.height) * Double(sourceWidth) / Double(mark.width)).rounded())
save(render(sourceWidth, sourceHeight), "assets/logo-source.png")
for size in [16, 32, 48, 128, 256] {
    save(render(size, size, padding: CGFloat(size) * 0.035), "icons/diarc-swoosh-\(size).png")
}
