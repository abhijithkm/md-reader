/**
 * What the window shows if the interface itself fails in a way nothing else caught. Without it
 * the window would be blank, with no menu and no keyboard shortcuts to get out of that.
 */
export function CrashNotice({ onReload }: { onReload: () => void }) {
  return (
    <main className="crash" role="alert">
      <h1>MD Reader ran into a problem</h1>
      <p>The window could not be drawn. Reload to start again, then open your file again.</p>
      <button type="button" className="button" onClick={onReload}>
        Reload
      </button>
    </main>
  );
}
