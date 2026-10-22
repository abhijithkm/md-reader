import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('summarises the open document', () => {
    render(
      <StatusBar
        name="notes.md"
        path="C:\docs\notes.md"
        sizeBytes={3482}
        stats={{ words: 1234, readingMinutes: 7, lines: 210 }}
        locale="en-US"
      />,
    );

    expect(screen.getByText('notes.md')).toHaveAttribute('title', 'C:\\docs\\notes.md');
    expect(screen.getByText('3.4 KB')).toBeInTheDocument();
    expect(screen.getByText('1,234 words')).toBeInTheDocument();
    expect(screen.getByText('7 min read')).toBeInTheDocument();
    expect(screen.getByText('210 lines')).toBeInTheDocument();
  });

  it('uses singular nouns for a single word and a single line', () => {
    render(
      <StatusBar
        name="a.md"
        sizeBytes={5}
        stats={{ words: 1, readingMinutes: 1, lines: 1 }}
        locale="en-US"
      />,
    );
    expect(screen.getByText('1 word')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('shows the file before the numbers are counted', () => {
    render(<StatusBar name="a.md" sizeBytes={5} locale="en-US" />);
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.queryByText(/word/)).toBeNull();
  });

  it('leaves out the reading time for an empty document', () => {
    render(
      <StatusBar
        name="a.md"
        sizeBytes={0}
        stats={{ words: 0, readingMinutes: 0, lines: 0 }}
        locale="en-US"
      />,
    );
    expect(screen.getByText('0 words')).toBeInTheDocument();
    expect(screen.queryByText(/min read/)).toBeNull();
  });

  it('says so when no document is open', () => {
    render(<StatusBar />);
    expect(screen.getByText('No document open')).toBeInTheDocument();
  });
});
