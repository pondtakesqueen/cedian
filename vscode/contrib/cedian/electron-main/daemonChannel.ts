/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { connect, Socket } from 'net';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPCServer, IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { DaemonConnectionState } from '../common/daemon.js';

/**
 * Carries a window's lines to the daemon's socket and back (spec §6.2): the sandboxed renderer
 * cannot open a socket, so the main process holds one connection per window and relays each
 * line unchanged. It understands none of them; the daemon owns all state. When nothing answers
 * on the socket it starts the daemon once (spec §6.4: the window starts the daemon if none
 * answers), then keeps trying with backoff for as long as the window is open.
 */
export class CedianDaemonChannel<TContext> extends Disposable implements IServerChannel<TContext> {

	private readonly connections = new Map<TContext, WindowConnection>();
	private started = false;

	constructor(ipcServer: IPCServer<TContext>) {
		super();
		this._register(ipcServer.onDidRemoveConnection(c => {
			this.connections.get(c.ctx)?.dispose();
			this.connections.delete(c.ctx);
		}));
	}

	listen<T>(ctx: TContext, event: string): Event<T> {
		const connection = this.connection(ctx);
		switch (event) {
			case 'onLine': return connection.onLine as Event<T>;
			case 'onState': return connection.onState as Event<T>;
		}
		throw new Error(`cedianDaemon: no event ${event}`);
	}

	async call<T>(ctx: TContext, command: string, arg?: unknown): Promise<T> {
		const connection = this.connection(ctx);
		switch (command) {
			case 'connect': connection.open(); return connection.state as T;
			case 'send': connection.send(String(arg)); return undefined as T;
		}
		throw new Error(`cedianDaemon: no command ${command}`);
	}

	private connection(ctx: TContext): WindowConnection {
		let connection = this.connections.get(ctx);
		if (!connection) {
			connection = new WindowConnection(socketPath(), () => this.startDaemon());
			this.connections.set(ctx, connection);
		}
		return connection;
	}

	/** Starts `cedian-daemon` detached, once per app launch: it outlives the window. */
	private startDaemon(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		const binary = daemonBinary();
		try {
			const child = spawn(binary, [], { detached: true, stdio: 'ignore' });
			child.on('error', error => console.error(`[cedian] could not start ${binary}: ${error.message}`));
			child.unref();
		} catch (error) {
			console.error(`[cedian] could not start ${binary}: ${error}`);
		}
	}

	override dispose(): void {
		for (const connection of this.connections.values()) {
			connection.dispose();
		}
		this.connections.clear();
		super.dispose();
	}
}

class WindowConnection {

	private readonly _onLine = new Emitter<string>();
	readonly onLine = this._onLine.event;
	private readonly _onState = new Emitter<DaemonConnectionState>();
	readonly onState = this._onState.event;

	state: DaemonConnectionState = 'disconnected';
	private socket: Socket | undefined;
	private rest = '';
	private opened = false;
	private disposed = false;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private failures = 0;

	constructor(private readonly path: string, private readonly startDaemon: () => void) { }

	open(): void {
		if (this.opened) {
			// A window that reloads asks again; tell it where things stand.
			this._onState.fire(this.state);
			return;
		}
		this.opened = true;
		this.dial();
	}

	send(line: string): void {
		if (this.state === 'connected' && this.socket) {
			this.socket.write(line.endsWith('\n') ? line : `${line}\n`);
		}
	}

	private dial(): void {
		if (this.disposed) {
			return;
		}
		this.setState('connecting');
		const socket = connect(this.path);
		this.socket = socket;
		socket.setEncoding('utf8');
		socket.on('connect', () => {
			this.failures = 0;
			this.setState('connected');
		});
		socket.on('data', (chunk: string) => {
			const lines = (this.rest + chunk).split('\n');
			this.rest = lines.pop() ?? '';
			for (const line of lines) {
				if (line.length > 0) {
					this._onLine.fire(line);
				}
			}
		});
		socket.on('error', () => { /* 'close' follows */ });
		socket.on('close', () => {
			if (this.socket !== socket) {
				return;
			}
			this.socket = undefined;
			this.rest = '';
			this.setState('disconnected');
			if (this.failures === 0) {
				this.startDaemon();
			}
			this.failures++;
			// 0.2 s, 0.4 s, … up to 5 s: a daemon that was just started takes a moment to bind.
			const wait = Math.min(5000, 200 * 2 ** Math.min(this.failures - 1, 5));
			this.retry = setTimeout(() => this.dial(), wait);
		});
	}

	private setState(state: DaemonConnectionState): void {
		this.state = state;
		this._onState.fire(state);
	}

	dispose(): void {
		this.disposed = true;
		if (this.retry) {
			clearTimeout(this.retry);
		}
		this.socket?.destroy();
		this.socket = undefined;
		this._onLine.dispose();
		this._onState.dispose();
	}
}

/** `cedian_wire::socket_path`: the daemon's state directory, worked out the same way. */
export function socketPath(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
	if (env.CEDIAN_STATE_DIR) {
		return join(env.CEDIAN_STATE_DIR, 'daemon.sock');
	}
	const home = env.HOME ?? homedir();
	if (platform === 'darwin') {
		return join(home, 'Library/Application Support/cedian/daemon.sock');
	}
	return join(env.XDG_STATE_HOME ?? join(home, '.local/state'), 'cedian/daemon.sock');
}

/** `$CEDIAN_DAEMON`, else the one beside the app's binary (Contents/MacOS), else the PATH's. */
function daemonBinary(): string {
	if (process.env.CEDIAN_DAEMON) {
		return process.env.CEDIAN_DAEMON;
	}
	const beside = join(dirname(process.execPath), 'cedian-daemon');
	return existsSync(beside) ? beside : 'cedian-daemon';
}

