# Console history browser verification

Run `node tests/browser/console-history-server.mjs`, then open
`http://127.0.0.1:5197/tests/browser/console-history-ui.html`.
The fixture renders the actual Terminal with an isolated ServerContext; every
API request fails locally. No backend, game, or command is involved.

`window.consoleFixture.replace(100000)` renders all100,000 rows. Verified in
the T3 browser:3.240s initial render, first line000000 and last line099999.
Create a native DOM Range from line0 through line4000, dispatch selectionchange,
and scroll the output. The selected text is232,020 characters. Record the
first row Node, Selection.toString(), and scrollTop. Append1,000 lines with
`window.consoleFixture.append(...)`: all three remain identical, all100,000
rows stay mounted, and the toolbar says Selection held. Observed143ms update.
Remove the selection and dispatch selectionchange: current history resumes
at line001000 and ends at the new output999, with100,000 retained rows.

Additional manual checks: dragging over text pauses follow; scrolling up pauses
follow; scrolling to the bottom or Resume auto-scroll resumes it. Copy uses
plain retained output, and Save console log downloads the same history.
The model tests verify limits, immutable chunk identity, ANSI state, and clear.

This is DOM Range/scroll proof, not a native OS clipboard or prolonged physical
mouse-drag acceptance claim. The console does not virtualize or recycle rows.
