/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AGENT_CONTAINER, movesFor, PLACES_VERSION, TOOLS, type Place } from './blocks/places.js';

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

/**
 * Lays the window out as the prototype does (src/blocks/places.ts): the agent pane in the left side
 * bar, and Files, Search, Git and Terminal as the tabs of the right one. Once per profile and
 * `PLACES_VERSION`: VS Code keeps where each went, and a part the person moves later stays moved.
 */
export class CedianWindowPlaces extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cedian.places';

	constructor(
		@IViewDescriptorService views: IViewDescriptorService,
		@IViewsService viewsService: IViewsService,
		@IStorageService storage: IStorageService,
	) {
		super();
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
		// Both sides showing, the agent and the first tool.
		void viewsService.openViewContainer(AGENT_CONTAINER, false);
		void viewsService.openViewContainer(TOOLS[0].container, false);
	}
}
