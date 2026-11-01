# Console history browser verification

The isolated fixture renders the real Terminal with ServerContext. API requests
are blocked; no game, command, or live service is involved.

Current behavior:

- Retain the newest 5,000 lines, bounded by 2,097,152 UTF-16 characters, or 4 MiB
  of text. The replay overlap buffers use the same limits.
- Render the viewport plus 40 lines on either side. The full retained buffer
  remains available to Copy console output and Save console log.
- Hold the history snapshot and keep the selection anchor mounted while a
  selection exists. Scrolling can expand that rendered range until selection
  is released. Resume auto-scroll returns to the current buffer and tail.

Verified with an offline headless Edge fixture on 2026-11-01:

- Loading 6,000 lines retains lines 1,000 through 5,999 and mounts fewer than
  150 rows at the tested viewport size.
- Copy returns all 5,000 retained lines, including offscreen output.
- Scrolling upward pauses auto-scroll. A DOM Range survives scrolling away
  and appending new output, and its original anchor stays mounted.
- Resume shows the latest output and returns to a bounded rendering window.
- Download includes the full current retained log. Clear empties the view.
- No page errors occurred.

These are synthetic browser checks. Native OS clipboard access, prolonged
physical mouse dragging, and the installed desktop app have not been verified.
The previous 100,000-row acceptance receipt describes superseded behavior.
