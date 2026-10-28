/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/agentPane.css';
import { Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ICedianDaemonService } from './daemonService.js';
import { SettingsView } from './settings/settings-view.js';

/** Cedian's settings window (spec §7.1), in place of VS Code's settings UI. */
export class CedianSettingsInput extends EditorInput {
	static readonly ID = 'workbench.input.cedian.settings';

	override get typeId(): string {
		return CedianSettingsInput.ID;
	}

	override get editorId(): string | undefined {
		return CedianSettingsEditor.ID;
	}

	override get resource(): URI {
		return URI.from({ scheme: 'cedian-settings', path: '/settings' });
	}

	override getName(): string {
		return 'Cedian Settings';
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof CedianSettingsInput;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Singleton | EditorInputCapabilities.Readonly;
	}
}

export class CedianSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.cedian.settings';

	private container: HTMLElement | undefined;
	private view: SettingsView | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(CedianSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent;
	}

	override async setInput(input: CedianSettingsInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || !this.container || this.view) {
			return;
		}
		const folder = this.workspace.getWorkspace().folders[0];
		this.view = new SettingsView(this.container.ownerDocument, this.daemon.client, {
			primary: folder?.uri.scheme === 'file' ? folder.uri.fsPath : undefined,
			isGitRepo: path => this.fileService.exists(joinPath(URI.file(path), '.git')),
		});
		this.container.append(this.view.root);
	}

	layout(dimension: Dimension): void {
		if (this.view) {
			this.view.root.style.height = `${dimension.height}px`;
		}
	}

	override dispose(): void {
		this.view?.dispose();
		super.dispose();
	}
}
