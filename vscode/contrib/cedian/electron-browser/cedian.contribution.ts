/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

// The desktop's half: the daemon connection lives in the main process.
import './daemonService.js';
import '../browser/cedian.contribution.js';
// The native browser view's safety banner: VS Code's browser editor lives in electron-browser.
import './siteBanner.js';
// The Browser block's console strip, element select and Dev servers on the native view.
import './nativeTools.js';
// The main window's frame on macOS's vibrancy (patch 0018 gives the window its NSVisualEffectView).
import './vibrancy.js';
