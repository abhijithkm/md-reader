import { useEffect, useRef, useState } from 'react';
import { isMarkdownFileName } from '../../shared/markdown-files';

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Lets the user drop a file anywhere on the window. The page must always
 * cancel dragover and drop: otherwise Chromium would navigate to the dropped
 * file and replace the app with its contents.
 */
export function useDropTarget(onDropFile: (file: File) => void): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDropFile);
  useEffect(() => {
    latest.current = onDropFile;
  });

  useEffect(() => {
    // dragenter/dragleave fire for every element the pointer crosses.
    let depth = 0;

    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer && carriesFiles(event)) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      depth = 0;
      setDragging(false);

      const files = Array.from(event.dataTransfer?.files ?? []);
      // Prefer a Markdown file; otherwise the first, so the user is told why it cannot be opened.
      const file = files.find((candidate) => isMarkdownFileName(candidate.name)) ?? files[0];
      if (file !== undefined) latest.current(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return { dragging };
}
