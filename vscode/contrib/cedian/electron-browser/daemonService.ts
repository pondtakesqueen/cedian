/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ConnectionState, DaemonClient, Transport } from '../browser/daemon-client/client.js';
import { ICedianDaemonService } from '../browser/daemonService.js';
import { CEDIAN_DAEMON_CHANNEL } from '../common/daemon.js';

/** Lines go through the main process, which holds this window's socket to the daemon. */
class CedianDaemonService extends Disposable implements ICedianDaemonService {
	declare readonly _serviceBrand: undefined;
	readonly client: DaemonClient;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		super();
		const channel = mainProcessService.getChannel(CEDIAN_DAEMON_CHANNEL);
		const transport: Transport = {
			send: line => { channel.call('send', line); },
			onLine: listener => { this._register(channel.listen<string>('onLine')(listener)); },
			onState: listener => { this._register(channel.listen<ConnectionState>('onState')(listener)); },
		};
		this.client = new DaemonClient(transport);
		channel.call('connect');
	}
}

registerSingleton(ICedianDaemonService, CedianDaemonService, InstantiationType.Delayed);
