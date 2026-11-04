/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { movesFor, PLACES_VERSION, THREADS_CONTAINER, TOOLS, type Place } from './blocks/places.js';
import { ensureCenter } from './threadsView.js';

const PLACE_OF: Record<ViewContainerLocation, Place> = {
	[ViewContainerLocation.Sidebar]: 'sidebar',
	[ViewContainerLocation.Panel]: 'panel',
	[ViewContainerLocation.AuxiliaryBar]: 'auxiliary',
};
const LOCATION_OF: Record<Place, ViewContainerLocation> = {
	sidebar: ViewContainerLocation.Sidebar,
	panel: ViewContainerLocation.Panel,
	auxiliary: ViewContainerLocation.AuxiliaryBar,
};

/** Which version of `PLACES` this profile's window was moved to. */
const PLACES_KEY = 'cedian.places';
/** Whether this project's window has had the agent in the middle opened. */
const CENTER_KEY = 'cedian.center';

/**
 * Lays the window out as the prototype does (src/blocks/places.ts): Threads in the left side bar,
 * the agent in the middle (an agent editor in a locked group of its own), and Files, Search, Git,
 * Terminal and the side agent as the tabs of the right one. Once per profile and
 * `PLACES_VERSION`: VS Code keeps where each went, and a part the person moves later stays moved.
 */
export class CedianWindowPlaces extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.places';

	constructor(
		@IViewDescriptorService views: IViewDescriptorService,
		@IViewsService viewsService: IViewsService,
		@IStorageService storage: IStorageService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroups: IEditorGroupsService,
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IConfigurationService configuration: IConfigurationService,
	) {
		super();
		// No activity bar, as in the prototype, while it stays at its default place so the right
		// panel's tabs are named in its title row (src/settings/desktop.ts). Hidden at each start
		// (VS Code keeps it as runtime state) and again when its place changes, which shows it.
		const hideActivityBar = () => {
			if (layout.isVisible(Parts.ACTIVITYBAR_PART)) {
				layout.setPartHidden(true, Parts.ACTIVITYBAR_PART);
			}
		};
		hideActivityBar();
		this._register(configuration.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.activityBar.location')) {
				// After the layout's own listener has shown it.
				setTimeout(hideActivityBar, 0);
			}
		}));
		// The agent in the middle, once per project: a person who closes it has it closed there.
		if (!storage.getBoolean(CENTER_KEY, StorageScope.WORKSPACE, false)) {
			storage.store(CENTER_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			ensureCenter(editorService, editorGroups).catch(() => { });
		}
		if (storage.getNumber(PLACES_KEY, StorageScope.PROFILE, 0) >= PLACES_VERSION) {
			return;
		}
		const where = (id: string): Place | undefined => {
			const container = views.getViewContainerById(id);
			const location = container ? views.getViewContainerLocation(container) : null;
			return location === null ? undefined : PLACE_OF[location];
		};
		for (const move of movesFor(where)) {
			const container = views.getViewContainerById(move.container);
			if (container) {
				views.moveViewContainerToLocation(container, LOCATION_OF[move.to], move.index, 'cedian.places');
			}
		}
		storage.store(PLACES_KEY, PLACES_VERSION, StorageScope.PROFILE, StorageTarget.MACHINE);
		// Both sides showing, Threads and the first tool.
		void viewsService.openViewContainer(THREADS_CONTAINER, false);
		void viewsService.openViewContainer(TOOLS[0].container, false);
	}
}
