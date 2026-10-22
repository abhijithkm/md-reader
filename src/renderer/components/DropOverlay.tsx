import { FileText } from 'lucide-react';

/** Shown while a file is dragged over the window. It never takes pointer events. */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-message">
        <FileText size={28} strokeWidth={1.5} />
        <span>Drop a Markdown file to open it</span>
      </div>
    </div>
  );
}
