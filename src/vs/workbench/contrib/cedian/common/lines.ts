/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Cedian. All rights reserved.
 *  Cedian's workbench contribution. Not part of VS Code; script/vscode/prepare copies it in.
 *--------------------------------------------------------------------------------------------*/

/**
 * Splits a byte stream into the daemon's lines: one JSON object per line on `cedian_wire`. The
 * main process reads the socket through it (electron-main/daemonChannel.ts), so a notice cut
 * across two reads arrives whole. Tested in test/lines.test.ts.
 */
export class LineSplitter {
	private rest = '';

	/** The complete lines in `chunk` with what was left from before; the tail waits for more. */
	push(chunk: string): string[] {
		const text = this.rest + chunk;
		const lines = text.split('\n');
		this.rest = lines.pop() ?? '';
		return lines.filter((line) => line.length > 0);
	}

	/** Anything left when the stream ended without a newline. */
	end(): string[] {
		const rest = this.rest;
		this.rest = '';
		return rest.length > 0 ? [rest] : [];
	}
}
