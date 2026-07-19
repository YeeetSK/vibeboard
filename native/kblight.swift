// Adapted from Maxnflaxl/kblight (MIT) for VibeBoard keyboard-alert flashes.
// Controls keyboard backlight via private CoreBrightness.KeyboardBrightnessClient.
//
// Usage:
//   kblight get
//   kblight <0.0-1.0>
//   kblight probe   # exit 0 if a backlit keyboard is available
//
// Compile: swiftc native/kblight.swift -o build/kblight

import Foundation
import ObjectiveC

enum KBLightError: Error, CustomStringConvertible {
  case frameworkLoadFailed(String)
  case classNotFound(String)
  case noKeyboards
  case setFailed
  case invalidArgument(String)

  var description: String {
    switch self {
    case .frameworkLoadFailed(let s):
      return "Failed to load CoreBrightness framework: \(s)"
    case .classNotFound(let n):
      return "Could not find ObjC class '\(n)' in CoreBrightness."
    case .noKeyboards:
      return "No keyboard backlight IDs reported by CoreBrightness."
    case .setFailed:
      return "setBrightness:forKeyboard: returned NO."
    case .invalidArgument(let s):
      return "Invalid argument: \(s)"
    }
  }
}

private typealias FloatFromID = @convention(c) (AnyObject, Selector, UInt64) -> Float
private typealias BoolFromID = @convention(c) (AnyObject, Selector, UInt64) -> Bool
private typealias BoolFromFloatAndID = @convention(c) (AnyObject, Selector, Float, UInt64) -> Bool
private typealias BoolFromFloatFadeCommitAndID = @convention(c) (
  AnyObject, Selector, Float, Int32, Bool, UInt64
) -> Bool

private let frameworkPath =
  "/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness"

final class KeyboardBacklight {
  let client: NSObject
  let getSel = NSSelectorFromString("brightnessForKeyboard:")
  let setSel = NSSelectorFromString("setBrightness:forKeyboard:")
  let setFadeSel = NSSelectorFromString("setBrightness:fadeSpeed:commit:forKeyboard:")
  let builtInSel = NSSelectorFromString("isKeyboardBuiltIn:")
  let idsSel = NSSelectorFromString("copyKeyboardBacklightIDs")

  init() throws {
    if dlopen(frameworkPath, RTLD_NOW) == nil {
      let err = dlerror().map { String(cString: $0) } ?? "unknown"
      throw KBLightError.frameworkLoadFailed(err)
    }
    guard let cls = NSClassFromString("KeyboardBrightnessClient") as? NSObject.Type else {
      throw KBLightError.classNotFound("KeyboardBrightnessClient")
    }
    client = cls.init()
  }

  func defaultKeyboardID() throws -> UInt64 {
    let ids = try keyboardIDs()
    guard !ids.isEmpty else { throw KBLightError.noKeyboards }
    let builtInIMP = client.method(for: builtInSel).map {
      unsafeBitCast($0, to: BoolFromID.self)
    }
    if let isBuiltIn = builtInIMP {
      for id in ids where isBuiltIn(client, builtInSel, id) {
        return id
      }
    }
    return ids[0]
  }

  func keyboardIDs() throws -> [UInt64] {
    guard let arr = client.perform(idsSel)?.takeRetainedValue() as? [NSNumber] else {
      throw KBLightError.noKeyboards
    }
    return arr.map { $0.uint64Value }
  }

  func brightness(forID id: UInt64) -> Double {
    let imp = client.method(for: getSel)!
    let fn = unsafeBitCast(imp, to: FloatFromID.self)
    return Double(fn(client, getSel, id))
  }

  /// Instant setpoint (fadeSpeed 0). Falls back to the fading setter if unavailable.
  func setBrightness(_ value: Double, forID id: UInt64) throws {
    let clamped = Float(max(0.0, min(1.0, value)))
    if client.responds(to: setFadeSel), let imp = client.method(for: setFadeSel) {
      let fn = unsafeBitCast(imp, to: BoolFromFloatFadeCommitAndID.self)
      if !fn(client, setFadeSel, clamped, 0, true, id) {
        throw KBLightError.setFailed
      }
      return
    }
    let imp = client.method(for: setSel)!
    let fn = unsafeBitCast(imp, to: BoolFromFloatAndID.self)
    if !fn(client, setSel, clamped, id) {
      throw KBLightError.setFailed
    }
  }
}

func die(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(code)
}

func parseFraction(_ s: String) throws -> Double {
  guard let v = Double(s), v.isFinite else {
    throw KBLightError.invalidArgument("'\(s)' is not a finite number")
  }
  return v
}

func main() {
  let args = Array(CommandLine.arguments.dropFirst())
  if args.isEmpty || args.contains("--help") || args.contains("-h") {
    print("Usage: kblight get | probe | <0.0-1.0>")
    exit(args.isEmpty ? 1 : 0)
  }

  let kb: KeyboardBacklight
  do { kb = try KeyboardBacklight() } catch { die("\(error)") }

  switch args[0] {
  case "probe":
    do {
      _ = try kb.defaultKeyboardID()
      print("ok")
    } catch { die("\(error)") }

  case "get":
    do {
      let id = try kb.defaultKeyboardID()
      print(String(format: "%.4f", kb.brightness(forID: id)))
    } catch { die("\(error)") }

  default:
    do {
      let v = try parseFraction(args[0])
      let id = try kb.defaultKeyboardID()
      try kb.setBrightness(v, forID: id)
    } catch { die("\(error)") }
  }
}

main()
