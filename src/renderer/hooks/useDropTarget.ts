import { useEffect, useRef, useState } from 'react';
import { isMarkdownFileName } from '../../shared/markdown-files';

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Lets the user drop files anywhere on the window. The page must always
 * cancel dragover and drop: otherwise Chromium would navigate to the dropped
 * file and replace the app with its contents.
 */
export function useDropTarget(onDropFiles: (files: File[]) => void): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDropFiles);
  useEffect(() => {
    latest.current = onDropFiles;
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
      // Every Markdown file opens, each in a tab of its own. When there is none, the first file is
      // handed over anyway, so that the user is told why it cannot be opened.
      const markdown = files.filter((candidate) => isMarkdownFileName(candidate.name));
      const [first] = files;
      const chosen = markdown.length > 0 ? markdown : first === undefined ? [] : [first];
      if (chosen.length > 0) latest.current(chosen);
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
