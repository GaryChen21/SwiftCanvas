/// Window geometry, frameless chrome and background color are declared in
/// `tauri.conf.json`. The runtime entry point is deliberately minimal: all IDE
/// logic lives in the webview, so no custom Rust commands are required.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running SwiftCanvas");
}
