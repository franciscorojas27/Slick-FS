import * as path from 'path';
import * as vscode from 'vscode';

const createAction = { id: 'create', label: 'Crear archivo o carpeta' } as const;
const renameAction = { id: 'rename', label: 'Mover o renombrar elemento' } as const;
const deleteAction = { id: 'delete', label: 'Eliminar elemento' } as const;
const browseAction = { id: 'browse', label: 'Navegar carpetas' } as const;
const SUGGESTION_LIMIT = 200;
const SUGGESTION_DISPLAY_LIMIT = 25;

let suggestionCache:
	| { workspace: string; entries: string[] }
	| undefined;

export function activate(context: vscode.ExtensionContext) {
	const commands: Array<{ id: string; handler: () => Promise<void> }> = [
		{ id: 'slick-fs.oil', handler: () => openOilMenu() },
		{ id: 'slick-fs.createPath', handler: () => createPath() },
		{ id: 'slick-fs.renamePath', handler: () => renamePath() },
		{ id: 'slick-fs.deletePath', handler: () => deletePath() },
		{ id: 'slick-fs.navigateFolders', handler: () => navigateFolders() },
	];

	for (const command of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(command.id, command.handler));
	}
}

async function openOilMenu(): Promise<void> {
	const choice = await vscode.window.showQuickPick([createAction, renameAction, deleteAction, browseAction], {
		placeHolder: 'Selecciona la operación de Slick FS',
	});
	if (!choice) {
		return;
	}

	switch (choice.id) {
		case createAction.id:
			await createPath();
			break;
		case renameAction.id:
			await renamePath();
			break;
		case deleteAction.id:
			await deletePath();
			break;
		case browseAction.id:
			await navigateFolders();
			break;
	}
}

async function createPath(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showInformationMessage('Abre una carpeta para usar Slick FS.');
		return;
	}

	const rawInput = await promptForPathInput('Ruta del nuevo archivo o carpeta', 'src/components/Button.tsx');
	if (!rawInput) {
		return;
	}

	const paths = Array.from(new Set(expandBracedPaths(rawInput)));
	const normalizedPaths = paths
		.map(normalizePath)
		.filter((entry): entry is NormalizedPath => Boolean(entry));

	if (!normalizedPaths.length) {
		vscode.window.showInformationMessage('La ruta no se pudo interpretar.');
		return;
	}

	const summary: string[] = [];
	let openedFirstFile = false;

	for (const normalized of normalizedPaths) {
		const targetIsFile = !normalized.isExplicitDirectory && hasExtension(normalized.name);
		const targetSegments = normalized.segments;
		const parentSegments = targetSegments.slice(0, -1);
		await ensureDirectories(workspaceRoot, parentSegments);

		const targetUri = vscode.Uri.joinPath(workspaceRoot, ...targetSegments);
		const existingType = await safeStat(targetUri);
		if (existingType) {
			summary.push(
				`${existingType === vscode.FileType.Directory ? 'Carpeta existente' : 'Archivo existente'}: ${normalized.path}`
			);
			if (existingType === vscode.FileType.File) {
				await openExisting(targetUri);
			}
			continue;
		}

		try {
			if (targetIsFile) {
				await vscode.workspace.fs.writeFile(targetUri, new Uint8Array());
				summary.push(`Archivo creado: ${normalized.path}`);
				if (!openedFirstFile) {
					await vscode.window.showTextDocument(targetUri);
					openedFirstFile = true;
				}
			} else {
				await vscode.workspace.fs.createDirectory(targetUri);
				summary.push(`Carpeta creada: ${normalized.path}`);
			}
		} catch (error) {
			showError(`No se pudo crear ${normalized.path}.`, error);
		}
	}

	invalidateSuggestionCache();
	if (summary.length) {
		vscode.window.showInformationMessage(summary.join(' · '));
	}
}

async function renamePath(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showInformationMessage('Abre una carpeta para usar Slick FS.');
		return;
	}

	const source = await promptForPath('Ruta actual del archivo o carpeta');
	if (!source) {
		return;
	}

	const sourceUri = vscode.Uri.joinPath(workspaceRoot, ...source.segments);
	const sourceType = await safeStat(sourceUri);
	if (!sourceType) {
		vscode.window.showInformationMessage(`No existe ${source.path}.`);
		return;
	}

	const targetDefault = source.path;
	const target = await promptForPath('Nueva ruta', targetDefault);
	if (!target) {
		return;
	}

	const destinationUri = vscode.Uri.joinPath(workspaceRoot, ...target.segments);
	const destinationParent = target.segments.slice(0, -1);
	await ensureDirectories(workspaceRoot, destinationParent);

	try {
		await vscode.workspace.fs.rename(sourceUri, destinationUri, { overwrite: false });
		if (sourceType === vscode.FileType.File) {
			await vscode.window.showTextDocument(destinationUri);
		}
		invalidateSuggestionCache();
		vscode.window.showInformationMessage(`Renombrado a ${target.path}.`);
	} catch (error) {
		showError('No se pudo renombrar el elemento.', error);
	}
}

async function deletePath(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showInformationMessage('Abre una carpeta para usar Slick FS.');
		return;
	}

	const normalized = await promptForPath('Ruta del archivo o carpeta a eliminar');
	if (!normalized) {
		return;
	}

	const targetUri = vscode.Uri.joinPath(workspaceRoot, ...normalized.segments);
	const targetType = await safeStat(targetUri);
	if (!targetType) {
		vscode.window.showInformationMessage(`No existe ${normalized.path}.`);
		return;
	}

	const confirmation = await vscode.window.showWarningMessage(
		`Eliminar ${normalized.path}?`,
		{ modal: true },
		'Eliminar'
	);
	if (confirmation !== 'Eliminar') {
		return;
	}

	try {
		await vscode.workspace.fs.delete(targetUri, { recursive: targetType === vscode.FileType.Directory });
		invalidateSuggestionCache();
		vscode.window.showInformationMessage(`${normalized.path} eliminado.`);
	} catch (error) {
		showError('No se pudo eliminar el elemento.', error);
	}
}

async function navigateFolders(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showInformationMessage('Abre una carpeta para usar Slick FS.');
		return;
	}

	const suggestions = await getPathSuggestions(workspaceRoot);
	const directories = suggestions.filter(entry => entry.endsWith('/'));
	if (!directories.length) {
		vscode.window.showInformationMessage('No se encontraron carpetas para navegar.');
		return;
	}

	const choice = await vscode.window.showQuickPick(
		directories.map(label => ({ label, description: 'Carpeta' })),
		{ placeHolder: 'Selecciona una carpeta para revelar en el Explorador' }
	);
	if (!choice) {
		return;
	}

	const cleaned = choice.label.endsWith('/') ? choice.label.slice(0, -1) : choice.label;
	const segments = cleaned ? cleaned.split('/').filter(segment => segment.length > 0) : [];
	const destination = segments.length ? vscode.Uri.joinPath(workspaceRoot, ...segments) : workspaceRoot;
	await vscode.commands.executeCommand('revealInExplorer', destination);
}

function invalidateSuggestionCache(): void {
	suggestionCache = undefined;
}

async function ensureDirectories(root: vscode.Uri, segments: string[]): Promise<void> {
	if (!segments.length) {
		return;
	}
	const dirUri = vscode.Uri.joinPath(root, ...segments);
	await vscode.workspace.fs.createDirectory(dirUri);
}

async function openExisting(uri: vscode.Uri): Promise<void> {
	await vscode.window.showTextDocument(uri);
	vscode.window.showInformationMessage('El archivo ya existe, lo abrí para ti.');
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function safeStat(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type;
	} catch {
		return undefined;
	}
}

async function promptForPath(prompt: string, defaultValue?: string): Promise<NormalizedPath | undefined> {
	const input = await promptForPathInput(prompt, defaultValue);
	if (!input) {
		return undefined;
	}
	const normalized = normalizePath(input);
	if (!normalized) {
		vscode.window.showInformationMessage('La ruta debe ser relativa, no puede incluir .. ni arrancar con /.');
	}
	return normalized;
}

async function promptForPathInput(prompt: string, defaultValue?: string): Promise<string | undefined> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showInformationMessage('Abre una carpeta para usar Slick FS.');
		return undefined;
	}

	const suggestions = await getPathSuggestions(workspaceRoot);
	const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
	quickPick.placeholder = prompt;
	quickPick.value = defaultValue ?? '';
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;
	quickPick.ignoreFocusOut = true;

	let selection: string | undefined;

	const buildItems = (filter: string) => {
		const normalizedFilter = filter.trim();
		const loweredFilter = normalizedFilter.toLowerCase();
		const matches = normalizedFilter
			? suggestions.filter(entry => entry.toLowerCase().includes(loweredFilter))
			: suggestions;
		const limited = Array.from(new Set(matches.slice(0, SUGGESTION_DISPLAY_LIMIT)));
		const items: vscode.QuickPickItem[] = [];
		if (normalizedFilter) {
			items.push({
				label: filter,
				description: 'Usar la ruta escrita',
			});
		}
		for (const entry of limited) {
			items.push({
				label: entry,
				description: entry.endsWith('/') ? 'Carpeta' : undefined,
			});
		}
		quickPick.items = items;
	};

	const promise = new Promise<string | undefined>(resolve => {
		const disposables: vscode.Disposable[] = [];
		disposables.push(
			quickPick.onDidChangeValue(() => buildItems(quickPick.value)),
			quickPick.onDidAccept(() => {
				const active = quickPick.activeItems[0];
				selection = active ? active.label : quickPick.value;
				quickPick.hide();
			}),
			quickPick.onDidHide(() => {
				resolve(selection?.trim() ? selection.trim() : undefined);
				disposables.forEach(disposable => disposable.dispose());
				quickPick.dispose();
			})
		);
	});

	buildItems(quickPick.value);
	quickPick.show();
	return promise;
}

async function getPathSuggestions(root: vscode.Uri): Promise<string[]> {
	if (suggestionCache?.workspace === root.fsPath) {
		return suggestionCache.entries;
	}

	const entries = new Set<string>();
	const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', SUGGESTION_LIMIT);
	for (const uri of files) {
		const relativeRaw = path.relative(root.fsPath, uri.fsPath);
		if (!relativeRaw || relativeRaw.startsWith('..')) {
			continue;
		}
		const relative = toPosix(relativeRaw);
		if (!relative) {
			continue;
		}
		entries.add(relative);
		const segments = relative.split('/');
		let accumulated = '';
		for (let i = 0; i < segments.length - 1; i++) {
			accumulated = accumulated ? `${accumulated}/${segments[i]}` : segments[i];
			entries.add(`${accumulated}/`);
		}
	}

	try {
		const rootItems = await vscode.workspace.fs.readDirectory(root);
		for (const [name, type] of rootItems) {
			if (type === vscode.FileType.Directory) {
				entries.add(`${name}/`);
			}
		}
	} catch {
		// Silently ignore
	}

	const sorted = Array.from(entries).sort();
	suggestionCache = { workspace: root.fsPath, entries: sorted };
	return sorted;
}

function expandBracedPaths(value: string): string[] {
	const match = value.match(/\{([^{}]+)\}/);
	if (!match) {
		return [value];
	}
	const [, inner] = match;
	const options = inner.split(',').map(option => option.trim()).filter(Boolean);
	if (!options.length) {
		return [value];
	}
	const results: string[] = [];
	for (const option of options) {
		const replaced = value.replace(match[0], option);
		results.push(...expandBracedPaths(replaced));
	}
	return results;
}

function toPosix(value: string): string {
	return value.replace(/\\+/g, '/');
}

function normalizePath(value: string): NormalizedPath | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const windowsSlashes = trimmed.replace(/\\+/g, '/');
	const collapsed = windowsSlashes.replace(/\/+/g, '/');
	const cleanedLeading = collapsed.replace(/^\.\//, '').replace(/^\//, '');
	if (!cleanedLeading || cleanedLeading.includes('..')) {
		return undefined;
	}

	const hasTrailing = /\/$/.test(cleanedLeading);
	const normalized = hasTrailing ? cleanedLeading.replace(/\/+$/, '') : cleanedLeading;
	if (!normalized) {
		return undefined;
	}

	const segments = normalized.split('/').filter(segment => segment.length > 0);
	if (!segments.length) {
		return undefined;
	}

	const name = segments[segments.length - 1];
	return {
		path: normalized,
		segments,
		name,
		isExplicitDirectory: hasTrailing,
	};
}

function hasExtension(name: string): boolean {
	return name.includes('.') && name.search(/\.\w+$/) !== -1;
}

function getWorkspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

interface NormalizedPath {
	path: string;
	segments: string[];
	name: string;
	isExplicitDirectory: boolean;
}

// Define the showError function to display error messages to the user
function showError(message: string, error: unknown) {
	vscode.window.showErrorMessage(`${message} Error: ${error}`);
}

export function deactivate() {}


