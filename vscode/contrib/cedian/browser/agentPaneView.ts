/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import './media/agentPane.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { FIXTURE, FIXTURE_NAME } from './agent-pane/fixture.js';
import { items } from './agent-pane/items.js';
import { renderItems } from './agent-pane/render.js';
import { applyBlocks, emptyView } from './agent-pane/view.js';

export const AGENT_PANE_CONTAINER_ID = 'workbench.view.cedian.agent';
export const AGENT_PANE_VIEW_ID = 'workbench.view.cedian.agent.pane';

/**
 * The agent pane. Phase A draws one of cedia's recorded fixtures, folded by the daemon's
 * `cedian_agent` at the pin, through the same notices a live thread will send; Phase B
 * replaces the fixture with the daemon's `Notice::Blocks` over `daemon.sock`.
 */
export class AgentPaneView extends ViewPane {

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		const root = append(parent, $('.cedian-agent-pane'));
		root.setAttribute('role', 'log');
		root.setAttribute('aria-label', `cedia fixture ${FIXTURE_NAME}`);
		root.dataset.fixture = FIXTURE_NAME;
		const view = applyBlocks(emptyView('fixture'), { kind: 'blocks', thread: 'fixture', from: 0, blocks: FIXTURE, run_cost: 0 });
		root.append(renderItems(root.ownerDocument, items(view.blocks)));
	}
}
