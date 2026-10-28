/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { DaemonClient } from './daemon-client/client.js';

export const ICedianDaemonService = createDecorator<ICedianDaemonService>('cedianDaemonService');

/** The window's one connection to the daemon; every part of Cedian's UI talks through it. */
export interface ICedianDaemonService {
	readonly _serviceBrand: undefined;
	readonly client: DaemonClient;
}
