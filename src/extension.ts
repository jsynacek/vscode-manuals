import * as vscode from 'vscode'
import * as child_process from 'node:child_process'

interface ManEntry {
    name: string,
    section: string
}

// Assumes to get a line from "man -k ...".
function parseManEntry(apropos: string): ManEntry {
    // Let's say the input is 'git-annotate (1) description'.
    const parts = apropos.split('(') // ['git-annotate ', '1) description']
    return {
        name: parts[0].trimEnd(),    // ['1', ' description']
        section: parts[1].split(')')[0]
    }
}

function systemManuals(): Thenable<readonly string[]> {
    return new Promise((resolve, _reject) => {
        const proc = child_process.spawnSync('man', ['-k', ''], { maxBuffer: 1024 * 1024 * 1024 })
        if (proc.error) {
            throw "is man installed?"
        }
        resolve(proc.stdout.toString().split('\n'))
    })
}

export function activate(context: vscode.ExtensionContext) {
    const manProvider = new class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
            const entry = parseManEntry(uri.path)
            const proc = child_process.spawnSync('man', [entry.section, entry.name])
            if (proc.error) {
                throw "is man installed?"
            }
            return proc.stdout.toString()
        }
    }
    let disposable = vscode.workspace.registerTextDocumentContentProvider('man', manProvider)
    context.subscriptions.push(disposable)

    const linkProvider = new class implements vscode.DocumentLinkProvider {
        provideDocumentLinks(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentLink[]> {
            let result: vscode.DocumentLink[] = []
            const lines = document.getText().split('\n')
            for (let i = 0; i < lines.length; i++) {
                // NOTE: This is line-based and will never work precisely. The issue is
                // that it parses an already rendered man output, which means that there
                // can be a link reference starting at the end of one line and continuing
                // at the beginning of the next line, in which case only the part that
                // is beginning on the next line is parsed as a link. There is no way
                // to fix or work around it.
                const matches = lines[i].matchAll(/[a-z][\w-]+\(\d\)/g)
                for (const match of matches) {
                    let uri = vscode.Uri.parse('man:' + match)
                    const pos = new vscode.Position(i, match.index ?? 0)
                    const link = new vscode.DocumentLink(new vscode.Range(pos, pos.translate(0, match[0].length)), uri)
                    result.push(link)
                }
            }
            return result
        }
    }
    disposable = vscode.languages.registerDocumentLinkProvider({ scheme: 'man' }, linkProvider)
    context.subscriptions.push(disposable)

    const foldProvider = new class implements vscode.FoldingRangeProvider {
        provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
            const lines = document.getText().split('\n')
            let result: vscode.FoldingRange[] = []
            // Every man page starts with the main heading followed by a new line.
            // Start folding on line 2, which should always be the start of the first section.
            let foldStart = 2
            for (let i = 3; i < lines.length; i++) {
                // NOTE: Some perl manuals have weird section names. For example, in IO::Socket::IP (3perl),
                // there's a section called "IO::Socket::INET" INCOMPATIBILITES, including the quotes.
                const match = lines[i].match(/^[A-Z"_.:'][A-Za-z"_.:' ,-]+$/)
                if (match) {
                    result.push(new vscode.FoldingRange(foldStart, i - 1, vscode.FoldingRangeKind.Region))
                    foldStart = i
                }
            }
            // Last region from the last section until the footer.
            // There are two assumptions here:
            //   1) The parsed man page has at least one valid section.
            //   2) The parsed man page has a footer preceded and followed by a new line.
            const to = lines.length - 4
            if (foldStart >= to)
                throw "Can't create final FoldingRange: invalid man page"
            result.push(new vscode.FoldingRange(foldStart, to, vscode.FoldingRangeKind.Region))
            return result
        }
    }
    disposable = vscode.languages.registerFoldingRangeProvider({ scheme: 'man' }, foldProvider)
    context.subscriptions.push(disposable)

    disposable = vscode.commands.registerCommand('manuals.man', async () => {
        let pick = await vscode.window.showQuickPick(systemManuals())
        if (pick) {
            let i = pick.indexOf(') ')
            let uri = vscode.Uri.parse('man:' + pick.slice(0, i + 1))
            let doc = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(doc, { preview: false })
        }
    })
    context.subscriptions.push(disposable)
}

export function deactivate() { }
