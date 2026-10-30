/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/agentPane.css';
import { Dimension } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, EditorsOrder, IEditorOpenContext, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { AUX_WINDOW_GROUP, IEditorService } from '../../../services/editor/common/editorService.js';
import { AgentPane } from './agent-pane/pane.js';
import { ICedianDaemonService } from './daemonService.js';
import { createPaneHost } from './paneHost.js';
import { CedianPanes, connectionBar } from './panes.js';

/** An agent pane popped out of the side bar into a window of its own, on one thread or a new one. */
export class CedianAgentInput extends EditorInput {
	static readonly ID = 'workbench.input.cedian.agent';

	/** The thread the pane shows; it follows the pane when the person picks another there. */
	constructor(public thread: string | undefined) {
		super();
	}

	override get typeId(): string {
		return CedianAgentInput.ID;
	}

	override get editorId(): string | undefined {
		return CedianAgentEditor.ID;
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override getName(): string {
		return 'Agent';
	}

	override matches(other: EditorInput | unknown): boolean {
		return other === this;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}
}

/** Keeps a popped-out pane's thread across a restart, as VS Code restores the window it was in. */
export class CedianAgentInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: CedianAgentInput): string {
		return JSON.stringify({ thread: input.thread ?? null });
	}

	deserialize(_instantiationService: IInstantiationService, serialized: string): CedianAgentInput | undefined {
		try {
			const { thread } = JSON.parse(serialized) as { thread?: unknown };
			return new CedianAgentInput(typeof thread === 'string' ? thread : undefined);
		} catch {
			return undefined;
		}
	}
}

/**
 * Opens `thread` (a new thread when none) in an agent pane in a window of its own, or brings
 * forward the window that already shows it.
 */
export async function popOutThread(editorService: IEditorService, thread: string | undefined): Promise<void> {
	const shown = thread ? editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(e => e.editor instanceof CedianAgentInput && e.editor.thread === thread) : undefined;
	if (shown) {
		await editorService.openEditor(shown.editor, { pinned: true }, shown.groupId);
		return;
	}
	await editorService.openEditor(new CedianAgentInput(thread), { pinned: true, auxiliary: { compact: true } }, AUX_WINDOW_GROUP);
}

/** The agent pane as an editor, which is what lets it sit in a window of its own. */
export class CedianAgentEditor extends EditorPane {
	static readonly ID = 'workbench.editor.cedian.agent';

	private container: HTMLElement | undefined;
	private pane: AgentPane | undefined;
	private readonly drawn = this._register(new DisposableStore());
	/** Keeps the input's thread the pane's, so a restart reopens the one shown last. */
	private readonly follow = this._register(new MutableDisposable());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICedianDaemonService private readonly daemon: ICedianDaemonService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IEditorGroupsService private readonly editorGroups: IEditorGroupsService,
	) {
		super(CedianAgentEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent;
	}

	override async setInput(input: CedianAgentInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || !this.container) {
			return;
		}
		if (!this.pane) {
			this.draw(this.container);
		}
		const pane = this.pane;
		if (!pane) {
			return;
		}
		if (input.thread) {
			pane.openThread(input.thread);
		} else {
			pane.newThread();
		}
		this.follow.value = toDisposable(this.daemon.client.onAny(() => { input.thread = pane.thread; }));
	}

	private draw(container: HTMLElement): void {
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder || folder.uri.scheme !== 'file') {
			return;
		}
		// Reviews from here open in the main window, beside the code, not over this pane.
		const host = this.instantiationService.invokeFunction(accessor => createPaneHost(accessor, folder, {
			reviewGroup: () => this.editorGroups.mainPart.activeGroup,
		}));
		const wire = CedianPanes.wire(this.daemon.client);
		// VS Code makes every element from the main window's document, a popped-out window's included.
		const pane = new AgentPane(mainWindow.document, wire, host);
		this.pane = pane;
		this.drawn.add({ dispose: () => { pane.dispose(); wire.dispose(); this.pane = undefined; } });
		const scoped = this.drawn.add(this.contextKeyService.createScoped(container));
		this.drawn.add(CedianPanes.add(pane, scoped));
		container.append(pane.root);
		this.drawn.add(connectionBar(pane.root, this.daemon.client));
	}

	override clearInput(): void {
		this.follow.clear();
		this.drawn.clear();
		this.container?.replaceChildren();
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.pane?.focusComposer();
	}

	layout(dimension: Dimension): void {
		if (this.pane) {
			this.pane.root.style.height = `${dimension.height}px`;
		}
	}
}
