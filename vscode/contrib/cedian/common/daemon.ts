/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

/** The main-process channel that relays a window's lines to `daemon.sock`. */
export const CEDIAN_DAEMON_CHANNEL = 'cedianDaemon';

export type DaemonConnectionState = 'connecting' | 'connected' | 'disconnected';
