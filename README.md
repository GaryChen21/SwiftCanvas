# SwiftCanvas

**SwiftUI → React/Tailwind Transpiler & Web Simulator.**

SwiftCanvas adalah editor + simulator iOS yang berjalan di browser dan di
desktop (Tauri). Anda menulis SwiftUI di editor; sebuah interpreter TypeScript
(lexer → parser → evaluator → view builder) menjalankannya, lalu renderer React
menggambar hasilnya di dalam bingkai iPhone. Preview-nya interaktif: `@State`,
`Button`, `ForEach`, navigasi, `.sheet`, dan `.alert` benar-benar bekerja —
tanpa perlu perangkat Mac. Cocok untuk belajar Swift/SwiftUI di Windows/Linux.

## Prasyarat

- **Node.js 22+ dan npm** — `npm test` memanfaatkan type stripping Node 22
  (Node 20 masih cukup untuk `dev`/`build`).
- **Rust toolchain** (`rustup` + MSVC Build Tools di Windows) — hanya bila
  ingin menjalankan shell desktop Tauri.
- **WebView2 runtime** — untuk mode desktop di Windows (sudah terpasang di
  Windows 11; Windows 10 perlu instal runtime WebView2).
- **Git**.

## Cara Menjalankan

```bash
git clone https://github.com/GaryChen21/SwiftCanvas.git
cd SwiftCanvas
npm install

# Mode browser (tanpa Rust)
npm run dev            # buka http://localhost:1420

# Mode desktop Tauri (butuh Rust)
npm run tauri:dev
```

Perintah lain:

```bash
npm run build           # build produksi (typecheck + vite)
npm run typecheck       # cek tipe TypeScript
npm test                # 40 tes regresi interpreter + transpiler legacy
npm run test:stress     # 37 tes stres SwiftUI (grid, GeometryReader, Path, Shape)
npm run tauri:build     # bundel aplikasi desktop
```

> Catatan Windows: bila `npm` diblokir execution policy PowerShell, gunakan
> `npm.cmd` (mis. `npm.cmd install`) atau jalankan
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Cara Penggunaan

1. Jalankan `npm run dev`, lalu buka `http://localhost:1420`.
2. Pilih file di **Project Navigator** (kiri), kemudian tulis kode SwiftUI di
   editor tengah — misalnya `ContentView.swift`.
3. Preview di kanan (bingkai iPhone) ikut menyegarkan otomatis (debounce
   300 ms), jadi Anda bisa langsung melihat hasilnya sambil mengetik.
4. Tekan **Run** atau `Ctrl/Cmd + R` untuk menjalankan ulang program dengan
   state yang bersih.
5. Pintasan lain: `Ctrl/Cmd + P` (buka file cepat / Quick Open),
   `Ctrl/Cmd + Shift + K` (bersihkan konsol).
6. Sintaks yang belum didukung tidak membuat crash: preview tetap tampil dan
   masalahnya dilaporkan sebagai diagnostics di toolbar/konsol.

Contoh cepat — tempel di editor lalu tekan Run:

```swift
struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Halo, SwiftCanvas!")
                .font(.title)
            Text("Count: \(count)")
            Button("Tambah") { count += 1 }
        }
        .padding()
    }
}
```

Batasan singkat: ini bukan compiler Swift penuh, melainkan interpreter untuk
subset SwiftUI yang praktis (lihat `src/utils/swift/`). `Image("nama")`
menampilkan placeholder abu-abu (tanpa aset gambar), dan nama SF Symbol yang
tidak ada di katalog tampil sebagai tile monogram, bukan kotak kosong.
