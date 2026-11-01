# SwiftCanvas

**Emulator SwiftUI dan klon IDE Xcode sumber terbuka khusus pengguna Windows.**

Tulis kode SwiftUI di editor, jalankan, dan lihat hasilnya langsung di bingkai
iPhone — tanpa perangkat Mac. Interpreter TypeScript (lexer → parser →
evaluator → view builder) mengeksekusi kode Anda dan renderer React menggambar
hasilnya. Preview-nya interaktif: `@State`, `Button`, `ForEach`, navigasi,
`.sheet`, dan `.alert` benar-benar bekerja.

`.frame(maxWidth: .infinity)` dipetakan ke `w-full` (dan `flex-1 basis-0` di
dalam `HStack`, seperti `Spacer()`), sehingga `Button` dan `TextField` melebar
penuh alih-alih menyusut mengikuti isinya. Parser menurunkan niat layout ini di
`src/utils/swift/layout.ts`; renderer memakai kelas Tailwind-nya sekaligus
inline style sebagai cadangan.

## Cara Menjalankan

Butuh **Node.js 22+** (dan Git).

```bash
git clone https://github.com/GaryChen21/SwiftCanvas.git
cd SwiftCanvas
npm install
npm run dev            # buka http://localhost:1420
```

Mode desktop Tauri (opsional, butuh Rust toolchain):

```bash
npm run tauri:dev
```

Verifikasi dan build produksi:

```bash
npm run typecheck      # cek tipe TypeScript
npm test               # 47 tes regresi interpreter
npm run test:stress    # 51 tes stres SwiftUI (grid, GeometryReader, Path, Button)
npm run build          # build produksi (typecheck + vite)
```

> Catatan Windows: bila `npm` diblokir execution policy PowerShell, gunakan
> `npm.cmd` (mis. `npm.cmd install`).

## Cara Penggunaan

1. Jalankan `npm run dev`, lalu buka `http://localhost:1420`.
2. Pilih file di **Project Navigator** (kiri), lalu tulis kode SwiftUI di
   editor tengah — misalnya `ContentView.swift`.
3. Preview di kanan menyegarkan otomatis (debounce 300 ms). Tekan **Run**
   atau `Ctrl/Cmd + R` untuk menjalankan ulang dengan state bersih.
4. Pintasan: `Ctrl/Cmd + P` (buka file cepat), `Ctrl/Cmd + Shift + K`
   (bersihkan konsol). Sintaks yang belum didukung tampil sebagai diagnostics,
   bukan crash.

Contoh cepat — tempel di editor lalu Run:

```swift
struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Halo, SwiftCanvas!").font(.title)
            Text("Count: \(count)")
            Button("Tambah") { count += 1 }
        }
        .padding()
    }
}
```

Ini bukan compiler Swift penuh, melainkan interpreter untuk subset SwiftUI
yang praktis (lihat `src/utils/swift/`). `Image("nama")` menampilkan
placeholder abu-abu, dan SF Symbol yang tidak ada di katalog tampil sebagai
tile monogram, bukan kotak kosong.
