/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';

/** On `<body>` of the main window while its frame shows macOS's vibrancy through (workbench.css). */
export const VIBRANCY_CLASS = 'cedian-vibrancy';

/**
 * The main window's frame and side bar as one sheet of macOS's vibrancy: the main process draws
 * the window on an NSVisualEffectView under a clear page (patch 0018), and this clears the
 * workbench's frame over it. With Reduce Transparency on or a high contrast theme the class goes
 * and the frame is painted solid again, as VS Code's frosted glass does for its pop-ups.
 */
class CedianVibrancy extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedianVibrancy';

	constructor(
		@IAccessibilityService private readonly accessibility: IAccessibilityService,
		@IThemeService private readonly theme: IThemeService,
		@IWorkbenchEnvironmentService private readonly environment: IWorkbenchEnvironmentService,
	) {
		super();
		// The main process gives the vibrancy to the Mac's main window only, as here.
		if (!isMacintosh || this.environment.isSessionsWindow) {
			return;
		}
		this._register(this.accessibility.onDidChangeReducedTransparency(() => this.update()));
		this._register(this.theme.onDidColorThemeChange(() => this.update()));
		this._register(toDisposable(() => mainWindow.document.body.classList.remove(VIBRANCY_CLASS)));
		this.update();
	}

	private update(): void {
		const on = !this.accessibility.isTransparencyReduced() && !isHighContrast(this.theme.getColorTheme().type);
		mainWindow.document.body.classList.toggle(VIBRANCY_CLASS, on);
	}
}

registerWorkbenchContribution2(CedianVibrancy.ID, CedianVibrancy, WorkbenchPhase.BlockStartup);
