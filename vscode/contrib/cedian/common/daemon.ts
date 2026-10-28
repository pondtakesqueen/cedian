/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

/** The main-process channel that relays a window's lines to `daemon.sock`. */
export const CEDIAN_DAEMON_CHANNEL = 'cedianDaemon';

export type DaemonConnectionState = 'connecting' | 'connected' | 'disconnected';

/** `cedian_wire::Build`: a daemon binary and that file's modification time, in whole seconds. */
export interface DaemonBuild {
	exe: string;
	modified: number;
}

/**
 * Whether the daemon that answered is another build than the window's own, or too old to say
 * (no `build` in its welcome): the window then replaces it, so a new app never drives a daemon
 * left running from an old one, or from a binary replaced in place since it started.
 */
export function isOtherBuild(running: DaemonBuild | null | undefined, own: DaemonBuild): boolean {
	return !running || running.exe !== own.exe || running.modified !== own.modified;
}
