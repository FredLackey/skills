import Cocoa

// Port of the research profile archiver. All profile data lives in resources.
func archive(_ object: Any) throws -> Data {
    return try NSKeyedArchiver.archivedData(withRootObject: object, requiringSecureCoding: false)
}

do {
    guard CommandLine.arguments.count == 3 else {
        throw NSError(domain: "Usage: generate-profile.swift resource.json output.terminal", code: 1)
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let config = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let spec = config["font"] as! [String: Any]
    let fontName = spec["name"] as! String
    guard let font = NSFont(name: fontName, size: CGFloat(spec["size"] as! Double)) else {
        throw NSError(domain: "Font unavailable: \(fontName). Run 01-install-dependencies.sh first.", code: 1)
    }
    var profile = config["profile"] as! [String: Any]
    for (key, value) in config["archives"] as! [String: Any] {
        if let name = value as? String, name == "font" {
            profile[key] = try archive(font)
        } else {
            let rgb = value as! [Double]
            profile[key] = try archive(NSColor(srgbRed: CGFloat(rgb[0]), green: CGFloat(rgb[1]), blue: CGFloat(rgb[2]), alpha: 1))
        }
    }
    let output = try PropertyListSerialization.data(fromPropertyList: profile, format: .xml, options: 0)
    try output.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
    print("Profile written to \(CommandLine.arguments[2])")
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
