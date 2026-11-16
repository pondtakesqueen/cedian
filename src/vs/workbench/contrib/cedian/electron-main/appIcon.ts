/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { app, nativeImage } from 'electron';
import { APP_ICONS } from './appIcons.js';

/**
 * Sets the Dock icon to the one `desktop.app_icon` picks (light unless the window says dark). It
 * lasts while Cedian runs; Finder and a Dock with Cedian closed show the bundle's light icon.
 */
export function setAppIcon(appearance: unknown): void {
	if (process.platform !== 'darwin' || !app.dock) {
		return;
	}
	app.dock.setIcon(nativeImage.createFromDataURL(appearance === 'dark' ? APP_ICONS.dark : APP_ICONS.light));
}
