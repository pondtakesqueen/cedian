/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import Severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { LATEST_RELEASE, updateCheck, updateMessage, type UpdateCheck } from './updates/updates.js';

/**
 * Cedian's own version (package.json's, which script/vscode/prepare writes into product.json as
 * `cedianVersion`); VS Code's `version` stays the upstream one extensions are checked against.
 */
function cedianVersion(productService: IProductService): string {
	const version = (productService as IProductService & { cedianVersion?: unknown }).cedianVersion;
	return typeof version === 'string' ? version : productService.version;
}

/**
 * Help → Check for updates: asks GitHub for the latest release only when the person picks it
 * (nothing is asked on its own, spec §13 telemetry gate), and says what it found in a dialog.
 */
export class CheckForUpdatesAction extends Action2 {
	static readonly ID = 'cedian.checkForUpdates';

	constructor() {
		super({
			id: CheckForUpdatesAction.ID,
			title: localize2('cedian.checkForUpdates', "Check for Updates..."),
			category: localize2('cedian.category', "Cedian"),
			f1: true,
			menu: [{ id: MenuId.MenubarHelpMenu, group: '1_welcome', order: 6 }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const requests = accessor.get(IRequestService);
		const dialogs = accessor.get(IDialogService);
		const opener = accessor.get(IOpenerService);
		const current = cedianVersion(accessor.get(IProductService));
		const source = new CancellationTokenSource();
		let check: UpdateCheck;
		try {
			const context = await requests.request({
				type: 'GET',
				url: LATEST_RELEASE,
				headers: { 'Accept': 'application/vnd.github+json' },
				timeout: 15_000,
				callSite: 'NO_FETCH_TELEMETRY',
			}, source.token);
			const text = await asText(context);
			let body: unknown;
			try {
				body = text ? JSON.parse(text) : undefined;
			} catch {
				body = undefined;
			}
			check = updateCheck(current, context.res.statusCode ?? 0, body);
		} catch (e) {
			check = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
		} finally {
			source.dispose();
		}
		const { message, detail, download } = updateMessage(check, current);
		if (!download) {
			await dialogs.prompt({ type: check.kind === 'error' ? Severity.Warning : Severity.Info, message, detail, buttons: [{ label: 'OK', run: () => { } }] });
			return;
		}
		const { result } = await dialogs.prompt({
			type: Severity.Info,
			message,
			detail,
			buttons: [{ label: 'Download', run: () => true }],
			cancelButton: { label: 'Later', run: () => false },
		});
		if (result) {
			await opener.open(URI.parse(download), { openExternal: true });
		}
	}
}
