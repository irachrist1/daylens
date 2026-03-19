// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Daylens",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "DaylensCore", targets: ["DaylensCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.24.0"),
    ],
    targets: [
        .target(
            name: "DaylensCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Daylens",
            exclude: ["Resources/Assets.xcassets", "Resources/Daylens.entitlements", "Info.plist"]
        ),
        .testTarget(
            name: "DaylensTests",
            dependencies: ["DaylensCore"],
            path: "DaylensTests"
        ),
    ]
)
