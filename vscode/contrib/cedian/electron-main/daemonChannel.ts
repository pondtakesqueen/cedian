/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

import { execFile, spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, renameSync, statSync } from 'fs';
import { connect, Socket } from 'net';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPCServer, IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { setAppIcon } from './appIcon.js';
import { DaemonBuild, DaemonConnectionState, isOtherBuild } from '../common/daemon.js';

/**
 * Carries a window's lines to the daemon's socket and back (spec §6.2): the sandboxed renderer
 * cannot open a socket, so the main process holds one connection per window and relays each
 * line unchanged. It understands none of them; the daemon owns all state. When nothing answers
 * on the socket it starts the daemon once (spec §6.4: the window starts the daemon if none
 * answers), then keeps trying with backoff for as long as the window is open. The one line it
 * reads is the daemon's welcome, to hand over from a daemon of another build (see `handOver`).
 */
export class CedianDaemonChannel<TContext> extends Disposable implements IServerChannel<TContext> {

	private readonly connections = new Map<TContext, WindowConnection>();
	private started = false;
	private handedOver = false;

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
			case 'appIcon': setAppIcon(arg); return undefined as T;
		}
		throw new Error(`cedianDaemon: no command ${command}`);
	}

	private connection(ctx: TContext): WindowConnection {
		let connection = this.connections.get(ctx);
		if (!connection) {
			connection = new WindowConnection(socketPath(), () => this.startDaemon(), line => this.checkBuild(line));
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
			// Its log goes where the launch agent's does (`daemon.log`), so a person can read it.
			const log = openLog(join(dirname(socketPath()), 'daemon.log'));
			const child = spawn(binary, [], { detached: true, stdio: ['ignore', log ?? 'ignore', log ?? 'ignore'] });
			if (log !== undefined) {
				closeSync(log);
			}
			child.on('error', error => console.error(`[cedian] could not start ${binary}: ${error.message}`));
			child.unref();
		} catch (error) {
			console.error(`[cedian] could not start ${binary}: ${error}`);
		}
	}

	/**
	 * The first line on each connection is the daemon's welcome. When it names another build than
	 * the daemon beside this app, or none, the old daemon is stopped once per app launch: the
	 * window's connections then close, and the first to retry starts this app's daemon, which takes
	 * over the runs. A daemon found only on the PATH is not checked.
	 */
	private checkBuild(line: string): void {
		if (this.handedOver) {
			return;
		}
		const own = ownBuild();
		let welcome: { kind?: string; build?: DaemonBuild | null } | undefined;
		try {
			welcome = JSON.parse(line);
		} catch {
			return;
		}
		if (!own || welcome?.kind !== 'welcome' || !isOtherBuild(welcome.build, own)) {
			return;
		}
		this.handedOver = true;
		handOver(welcome.build?.exe, own.exe);
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
	private welcomed = false;

	constructor(
		private readonly path: string,
		private readonly startDaemon: () => void,
		private readonly onWelcome: (line: string) => void,
	) { }

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
		this.welcomed = false;
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
					if (!this.welcomed) {
						this.welcomed = true;
						this.onWelcome(line);
					}
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

/** Opens the daemon's log to append, after moving one past 5 MB to `daemon.log.old`. */
function openLog(path: string): number | undefined {
	try {
		mkdirSync(dirname(path), { recursive: true });
		if (existsSync(path) && statSync(path).size > 5 * 1024 * 1024) {
			renameSync(path, `${path}.old`);
		}
		return openSync(path, 'a');
	} catch (error) {
		console.error(`[cedian] could not open ${path}: ${error}`);
		return undefined;
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

/** The build of the daemon beside this app (or `$CEDIAN_DAEMON`); none for one on the PATH. */
function ownBuild(): DaemonBuild | undefined {
	const binary = daemonBinary();
	if (binary === 'cedian-daemon') {
		return undefined;
	}
	try {
		const exe = realpathSync(binary);
		return { exe, modified: Math.floor(statSync(exe).mtimeMs / 1000) };
	} catch {
		return undefined;
	}
}

/**
 * Stops the daemon of another build (by its binary, else by name when it is too old to say) and,
 * when the person has the LaunchAgent, reinstalls it with this app's daemon so login starts this
 * build too. `install` replaces the launchd job; a second daemon finding the socket taken exits.
 */
function handOver(oldExe: string | undefined, ownExe: string): void {
	const escaped = oldExe?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const args = escaped ? ['-TERM', '-f', '-x', escaped] : ['-TERM', '-x', 'cedian-daemon'];
	execFile('pkill', args, () => {
		const plist = join(homedir(), 'Library/LaunchAgents/dev.cedian.daemon.plist');
		if (process.platform === 'darwin' && existsSync(plist)) {
			execFile(ownExe, ['install'], error => {
				if (error) {
					console.error(`[cedian] could not reinstall the LaunchAgent: ${error.message}`);
				}
			});
		}
	});
}

/** `$CEDIAN_DAEMON`, else the one beside the app's binary (Contents/MacOS), else the PATH's. */
function daemonBinary(): string {
	if (process.env.CEDIAN_DAEMON) {
		return process.env.CEDIAN_DAEMON;
	}
	const beside = join(dirname(process.execPath), 'cedian-daemon');
	return existsSync(beside) ? beside : 'cedian-daemon';
}

