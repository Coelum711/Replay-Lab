// Dumps the ICU Han→Latin (Mandarin) reading of every CJK Unified Ideograph
// (U+4E00–U+9FFF), one tone-stripped syllable per line. ICU's transform data is
// derived from Unicode Unihan (Unicode License v3).
// Usage: swift scripts/lipsync/dump-pinyin.swift /tmp/pinyin.txt
import Foundation
var out = ""
for cp in 0x4E00...0x9FFF {
  guard let sc = Unicode.Scalar(cp) else { continue }
  let s = NSMutableString(string: String(Character(sc)))
  CFStringTransform(s, nil, kCFStringTransformMandarinLatin, false)
  CFStringTransform(s, nil, kCFStringTransformStripDiacritics, false)
  out += "\(s)\n"
}
try! out.write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
