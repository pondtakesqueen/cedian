/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { AgentPaneView, AGENT_PANE_CONTAINER_ID, AGENT_PANE_VIEW_ID } from './agentPaneView.js';

const agentIcon = registerIcon('cedian-agent-view-icon', Codicon.commentDiscussion, localize('cedianAgentIcon', 'View icon of the Cedian agent pane.'));

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: AGENT_PANE_CONTAINER_ID,
	title: localize2('cedian.agent.container', "Agent"),
	icon: agentIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [AGENT_PANE_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: AGENT_PANE_CONTAINER_ID,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: AGENT_PANE_VIEW_ID,
	name: localize2('cedian.agent.view', "Agent"),
	containerIcon: agentIcon,
	ctorDescriptor: new SyncDescriptor(AgentPaneView),
	canToggleVisibility: false,
	canMoveView: true,
}], container);
