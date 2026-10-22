# Welcome to MD Reader

MD Reader opens **Markdown** files and shows them as clean, readable documents. It works offline, needs no account, and sends nothing anywhere.

> Drag a `.md` file onto the window, press <kbd>Ctrl</kbd>+<kbd>O</kbd>, or double-click one in Explorer.

## What it renders

| Feature                  | Supported | Notes                                            |
| :----------------------- | :-------: | :----------------------------------------------- |
| Headings, lists, quotes  |    Yes    | `#` through `######`                             |
| GitHub Flavored Markdown |    Yes    | tables, task lists, strikethrough, footnotes     |
| Syntax highlighting      |    Yes    | TypeScript, PowerShell, JSON, YAML and many more |
| Relative images, links   |    Yes    | resolved next to the document, not the app       |

## A reading list

- [x] Open a file
- [x] Switch between light and dark
- [ ] Make MD Reader your default Markdown app

1. Zoom with <kbd>Ctrl</kbd>+<kbd>Plus</kbd> and <kbd>Ctrl</kbd>+<kbd>Minus</kbd>
2. Reset with <kbd>Ctrl</kbd>+<kbd>0</kbd>
   - or hold <kbd>Ctrl</kbd> and turn the mouse wheel
3. Reload after editing the file with <kbd>F5</kbd>

## Code

```ts
interface Doc {
  path: string;
  words: number;
}

const readingMinutes = (doc: Doc): number => Math.ceil(doc.words / 200);
```

```powershell
Get-ChildItem -Filter *.md -Recurse | Select-Object -First 5 Name, Length
```

## Links and notes

External links open in your browser: [MD Reader on GitHub](https://github.com/abhijithkm/md-reader). Links to other Markdown files open in the same window, and **Back** (<kbd>Alt</kbd>+<kbd>Left</kbd>) returns you. Jump within a page with a [heading link](#what-it-renders)[^1].

[^1]: Footnotes work too, and the arrow beside the note takes you back to the text.

---

Text can be ~~struck through~~, _emphasised_ or **strong**. Longer explanations fold away:

<details>
<summary>Show details</summary>

Collapsible sections are supported, and so is a little inline HTML. Scripts and anything else that could run code are removed.

</details>
