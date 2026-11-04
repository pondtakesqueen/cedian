# Security

## Reporting a vulnerability

Please report a security problem privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for it.

Say what is affected, how to reproduce it, and what an attacker gains. You will get an answer within a week.

## Scope

- The daemon (`daemon/`): the `daemon.sock` socket, the state it keeps, and anything it runs.
- The app (`src/`, `vscode/`): the browser pane, settings handling, and what the window can make the daemon do.

A problem in the agent itself (tools, sandbox, permissions) belongs to the `cedia` repository.
